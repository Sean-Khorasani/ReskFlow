import { EventEmitter } from 'events';
import Bull from 'bull';
import { v4 as uuidv4 } from 'uuid';
import { prisma, logger } from '@reskflow/shared';
import PQueue from 'p-queue';
import _ from 'lodash';

interface WorkflowStep {
  id: string;
  name: string;
  service: string;
  action: string;
  input: any;
  retries?: number;
  timeout?: number;
  compensate?: {
    service: string;
    action: string;
    input?: any;
  };
  conditions?: {
    type: 'success' | 'failure' | 'conditional';
    expression?: string;
    nextStep?: string;
  }[];
}

interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  description: string;
  steps: WorkflowStep[];
  triggers?: {
    type: 'event' | 'schedule' | 'manual';
    config: any;
  }[];
  timeout?: number;
  maxRetries?: number;
}

interface WorkflowInstance {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep?: string;
  context: any;
  startedAt: Date;
  completedAt?: Date;
  error?: any;
  steps: {
    stepId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    startedAt?: Date;
    completedAt?: Date;
    output?: any;
    error?: any;
    retries?: number;
  }[];
}

interface SagaTransaction {
  id: string;
  steps: {
    stepId: string;
    status: 'pending' | 'completed' | 'compensated';
    forward: () => Promise<any>;
    compensate: () => Promise<void>;
  }[];
}

export class WorkflowEngine extends EventEmitter {
  private workflows: Map<string, WorkflowDefinition>;
  private instances: Map<string, WorkflowInstance>;
  private sagaTransactions: Map<string, SagaTransaction>;
  private workflowQueue: Bull.Queue;
  private executionQueue: PQueue;

  constructor() {
    super();
    this.workflows = new Map();
    this.instances = new Map();
    this.sagaTransactions = new Map();
    
    this.workflowQueue = new Bull('workflow-queue', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    });

    this.executionQueue = new PQueue({ concurrency: 10 });
    
    this.setupQueueProcessors();
    this.loadWorkflows();
  }

  async registerWorkflow(definition: WorkflowDefinition): Promise<void> {
    // Validate workflow
    this.validateWorkflow(definition);

    // Store workflow
    await prisma.workflowDefinition.create({
      data: {
        id: definition.id,
        name: definition.name,
        version: definition.version,
        description: definition.description,
        steps: definition.steps,
        triggers: definition.triggers,
        timeout: definition.timeout,
        max_retries: definition.maxRetries,
        created_at: new Date(),
      },
    });

    this.workflows.set(definition.id, definition);
    
    // Setup triggers if defined
    if (definition.triggers) {
      await this.setupTriggers(definition);
    }

    logger.info(`Workflow registered: ${definition.name} v${definition.version}`);
  }

  async executeWorkflow(
    workflowId: string,
    input: any,
    options?: {
      async?: boolean;
      priority?: number;
      delay?: number;
    }
  ): Promise<WorkflowInstance | string> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const instance: WorkflowInstance = {
      id: uuidv4(),
      workflowId,
      status: 'pending',
      context: {
        input,
        variables: {},
        output: {},
      },
      startedAt: new Date(),
      steps: workflow.steps.map(step => ({
        stepId: step.id,
        status: 'pending',
      })),
    };

    // Store instance
    await this.saveInstance(instance);
    this.instances.set(instance.id, instance);

    if (options?.async) {
      // Queue for async execution
      await this.workflowQueue.add(
        'execute-workflow',
        { instanceId: instance.id },
        {
          priority: options.priority || 0,
          delay: options.delay || 0,
        }
      );
      
      return instance.id;
    } else {
      // Execute synchronously
      await this.executeInstance(instance.id);
      return instance;
    }
  }

  async getWorkflowStatus(instanceId: string): Promise<WorkflowInstance | null> {
    const instance = this.instances.get(instanceId);
    if (instance) return instance;

    // Load from database if not in memory
    const dbInstance = await prisma.workflowInstance.findUnique({
      where: { id: instanceId },
    });

    return dbInstance ? this.formatInstance(dbInstance) : null;
  }

  async cancelWorkflow(instanceId: string, reason?: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance || instance.status === 'completed' || instance.status === 'failed') {
      throw new Error('Cannot cancel workflow in current state');
    }

    instance.status = 'cancelled';
    instance.completedAt = new Date();
    instance.error = { reason: reason || 'Cancelled by user' };

    await this.saveInstance(instance);
    
    // Trigger compensations if needed
    await this.compensateWorkflow(instance);

    this.emit('workflow-cancelled', instance);
  }

  // Saga pattern implementation
  async executeSaga(
    steps: Array<{
      name: string;
      forward: () => Promise<any>;
      compensate: () => Promise<void>;
    }>
  ): Promise<any> {
    const sagaId = uuidv4();
    const transaction: SagaTransaction = {
      id: sagaId,
      steps: steps.map((step, index) => ({
        stepId: `${sagaId}-${index}`,
        status: 'pending',
        forward: step.forward,
        compensate: step.compensate,
      })),
    };

    this.sagaTransactions.set(sagaId, transaction);

    const completedSteps: number[] = [];
    let lastResult: any;

    try {
      // Execute forward path
      for (let i = 0; i < transaction.steps.length; i++) {
        const step = transaction.steps[i];
        
        logger.info(`Executing saga step ${i}: ${steps[i].name}`);
        
        lastResult = await step.forward();
        step.status = 'completed';
        completedSteps.push(i);
      }

      // All steps completed successfully
      this.sagaTransactions.delete(sagaId);
      return lastResult;
    } catch (error) {
      logger.error(`Saga ${sagaId} failed at step ${completedSteps.length}:`, error);
      
      // Compensate in reverse order
      for (let i = completedSteps.length - 1; i >= 0; i--) {
        const step = transaction.steps[i];
        
        try {
          logger.info(`Compensating saga step ${i}: ${steps[i].name}`);
          await step.compensate();
          step.status = 'compensated';
        } catch (compensateError) {
          logger.error(`Failed to compensate step ${i}:`, compensateError);
          // Continue with other compensations
        }
      }

      this.sagaTransactions.delete(sagaId);
      throw error;
    }
  }

  // Common workflow patterns
  async executeOrderWorkflow(orderData: any): Promise<any> {
    return this.executeWorkflow('order-processing', orderData);
  }

  async executeDeliveryWorkflow(reskflowData: any): Promise<any> {
    return this.executeWorkflow('reskflow-assignment', reskflowData);
  }

  async executeRefundWorkflow(refundData: any): Promise<any> {
    return this.executeWorkflow('refund-processing', refundData);
  }

  private async executeInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error('Instance not found');

    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) throw new Error('Workflow not found');

    instance.status = 'running';
    await this.saveInstance(instance);

    try {
      // Execute steps sequentially
      for (const step of workflow.steps) {
        if (instance.status === 'cancelled') break;

        instance.currentStep = step.id;
        const stepInstance = instance.steps.find(s => s.stepId === step.id)!;
        
        await this.executeStep(instance, step, stepInstance);
        
        // Check conditions for next step
        if (step.conditions) {
          const nextStepId = await this.evaluateConditions(
            step.conditions,
            stepInstance,
            instance.context
          );
          
          if (nextStepId) {
            // Jump to specific step
            const nextStepIndex = workflow.steps.findIndex(s => s.id === nextStepId);
            if (nextStepIndex > -1) {
              // Skip intermediate steps
              for (let i = workflow.steps.indexOf(step) + 1; i < nextStepIndex; i++) {
                instance.steps[i].status = 'skipped';
              }
            }
          }
        }
      }

      if (instance.status !== 'cancelled') {
        instance.status = 'completed';
        instance.completedAt = new Date();
      }
    } catch (error) {
      instance.status = 'failed';
      instance.completedAt = new Date();
      instance.error = error;
      
      // Trigger compensations
      await this.compensateWorkflow(instance);
      
      throw error;
    } finally {
      await this.saveInstance(instance);
      this.emit('workflow-completed', instance);
    }
  }

  private async executeStep(
    instance: WorkflowInstance,
    step: WorkflowStep,
    stepInstance: any
  ): Promise<void> {
    stepInstance.status = 'running';
    stepInstance.startedAt = new Date();
    
    const maxRetries = step.retries || 3;
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Prepare input with context
        const input = this.prepareStepInput(step.input, instance.context);
        
        // Execute step action
        const output = await this.executeStepAction(
          step.service,
          step.action,
          input,
          step.timeout
        );
        
        // Store output in context
        instance.context.output[step.id] = output;
        stepInstance.output = output;
        stepInstance.status = 'completed';
        stepInstance.completedAt = new Date();
        
        return;
      } catch (error) {
        lastError = error;
        stepInstance.retries = attempt;
        
        if (attempt < maxRetries) {
          // Exponential backoff
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    // All retries failed
    stepInstance.status = 'failed';
    stepInstance.error = lastError;
    stepInstance.completedAt = new Date();
    
    throw lastError;
  }

  private async executeStepAction(
    service: string,
    action: string,
    input: any,
    timeout?: number
  ): Promise<any> {
    // This would call the actual service
    // For now, mock implementation
    logger.info(`Executing ${service}.${action} with input:`, input);
    
    // Simulate service call
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() > 0.9) {
          reject(new Error(`${service}.${action} failed`));
        } else {
          resolve({ success: true, data: { processedBy: service } });
        }
      }, 100);
    });
  }

  private prepareStepInput(template: any, context: any): any {
    // Replace template variables with context values
    const json = JSON.stringify(template);
    const replaced = json.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = _.get(context, path);
      return value !== undefined ? JSON.stringify(value) : match;
    });
    
    return JSON.parse(replaced);
  }

  private async evaluateConditions(
    conditions: any[],
    stepResult: any,
    context: any
  ): Promise<string | null> {
    for (const condition of conditions) {
      let matches = false;
      
      switch (condition.type) {
        case 'success':
          matches = stepResult.status === 'completed';
          break;
        case 'failure':
          matches = stepResult.status === 'failed';
          break;
        case 'conditional':
          matches = this.evaluateExpression(condition.expression, context);
          break;
      }
      
      if (matches && condition.nextStep) {
        return condition.nextStep;
      }
    }
    
    return null;
  }

  private evaluateExpression(expression: string, context: any): boolean {
    // Simple expression evaluation
    // In production, use a proper expression evaluator
    try {
      const func = new Function('context', `return ${expression}`);
      return func(context);
    } catch (error) {
      logger.error('Failed to evaluate expression:', error);
      return false;
    }
  }

  private async compensateWorkflow(instance: WorkflowInstance): Promise<void> {
    const workflow = this.workflows.get(instance.workflowId);
    if (!workflow) return;

    // Find completed steps that need compensation
    const completedSteps = instance.steps
      .filter(s => s.status === 'completed')
      .map(s => {
        const stepDef = workflow.steps.find(ws => ws.id === s.stepId);
        return { instance: s, definition: stepDef };
      })
      .filter(s => s.definition?.compensate)
      .reverse(); // Compensate in reverse order

    for (const { instance: stepInstance, definition } of completedSteps) {
      try {
        const compensateInput = this.prepareStepInput(
          definition!.compensate!.input || stepInstance.output,
          instance.context
        );
        
        await this.executeStepAction(
          definition!.compensate!.service,
          definition!.compensate!.action,
          compensateInput
        );
        
        logger.info(`Compensated step ${stepInstance.stepId}`);
      } catch (error) {
        logger.error(`Failed to compensate step ${stepInstance.stepId}:`, error);
      }
    }
  }

  private validateWorkflow(definition: WorkflowDefinition): void {
    if (!definition.id || !definition.name) {
      throw new Error('Workflow must have id and name');
    }

    if (!definition.steps || definition.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }

    // Validate step references
    const stepIds = new Set(definition.steps.map(s => s.id));
    
    for (const step of definition.steps) {
      if (step.conditions) {
        for (const condition of step.conditions) {
          if (condition.nextStep && !stepIds.has(condition.nextStep)) {
            throw new Error(`Invalid step reference: ${condition.nextStep}`);
          }
        }
      }
    }
  }

  private async setupTriggers(workflow: WorkflowDefinition): Promise<void> {
    if (!workflow.triggers) return;

    for (const trigger of workflow.triggers) {
      switch (trigger.type) {
        case 'event':
          // Setup event listener
          this.on(trigger.config.eventName, async (data) => {
            await this.executeWorkflow(workflow.id, data, { async: true });
          });
          break;
          
        case 'schedule':
          // Setup cron job
          // Implementation would use node-cron or similar
          break;
          
        case 'manual':
          // No setup needed
          break;
      }
    }
  }

  private async saveInstance(instance: WorkflowInstance): Promise<void> {
    await prisma.workflowInstance.upsert({
      where: { id: instance.id },
      create: {
        id: instance.id,
        workflow_id: instance.workflowId,
        status: instance.status,
        current_step: instance.currentStep,
        context: instance.context,
        started_at: instance.startedAt,
        completed_at: instance.completedAt,
        error: instance.error,
        steps: instance.steps,
      },
      update: {
        status: instance.status,
        current_step: instance.currentStep,
        context: instance.context,
        completed_at: instance.completedAt,
        error: instance.error,
        steps: instance.steps,
      },
    });
  }

  private formatInstance(dbInstance: any): WorkflowInstance {
    return {
      id: dbInstance.id,
      workflowId: dbInstance.workflow_id,
      status: dbInstance.status,
      currentStep: dbInstance.current_step,
      context: dbInstance.context,
      startedAt: dbInstance.started_at,
      completedAt: dbInstance.completed_at,
      error: dbInstance.error,
      steps: dbInstance.steps,
    };
  }

  private setupQueueProcessors(): void {
    this.workflowQueue.process('execute-workflow', async (job) => {
      const { instanceId } = job.data;
      await this.executeInstance(instanceId);
    });
  }

  private loadWorkflows(): void {
    // Load predefined workflows
    const workflows: WorkflowDefinition[] = [
      {
        id: 'order-processing',
        name: 'Order Processing Workflow',
        version: 1,
        description: 'Complete order processing from placement to reskflow',
        steps: [
          {
            id: 'validate-order',
            name: 'Validate Order',
            service: 'order',
            action: 'validate',
            input: { orderId: '{{input.orderId}}' },
          },
          {
            id: 'process-payment',
            name: 'Process Payment',
            service: 'payment',
            action: 'charge',
            input: {
              orderId: '{{input.orderId}}',
              amount: '{{input.amount}}',
              paymentMethod: '{{input.paymentMethod}}',
            },
            compensate: {
              service: 'payment',
              action: 'refund',
            },
          },
          {
            id: 'confirm-order',
            name: 'Confirm Order',
            service: 'order',
            action: 'confirm',
            input: {
              orderId: '{{input.orderId}}',
              paymentId: '{{output.process-payment.paymentId}}',
            },
          },
          {
            id: 'assign-reskflow',
            name: 'Assign Delivery',
            service: 'reskflow',
            action: 'assign',
            input: {
              orderId: '{{input.orderId}}',
              location: '{{input.reskflowLocation}}',
            },
          },
          {
            id: 'notify-customer',
            name: 'Notify Customer',
            service: 'notification',
            action: 'send',
            input: {
              customerId: '{{input.customerId}}',
              template: 'order-confirmed',
              data: {
                orderId: '{{input.orderId}}',
                estimatedDelivery: '{{output.assign-reskflow.estimatedTime}}',
              },
            },
          },
        ],
      },
      {
        id: 'reskflow-assignment',
        name: 'Delivery Assignment Workflow',
        version: 1,
        description: 'Assign reskflow to driver with fallback options',
        steps: [
          {
            id: 'find-drivers',
            name: 'Find Available Drivers',
            service: 'driver',
            action: 'findAvailable',
            input: {
              location: '{{input.location}}',
              radius: 5,
            },
          },
          {
            id: 'assign-driver',
            name: 'Assign Driver',
            service: 'reskflow',
            action: 'assignDriver',
            input: {
              orderId: '{{input.orderId}}',
              drivers: '{{output.find-drivers.drivers}}',
            },
            conditions: [
              {
                type: 'failure',
                nextStep: 'expand-search',
              },
            ],
          },
          {
            id: 'expand-search',
            name: 'Expand Search Radius',
            service: 'driver',
            action: 'findAvailable',
            input: {
              location: '{{input.location}}',
              radius: 10,
            },
          },
          {
            id: 'notify-driver',
            name: 'Notify Driver',
            service: 'notification',
            action: 'notifyDriver',
            input: {
              driverId: '{{output.assign-driver.driverId}}',
              orderId: '{{input.orderId}}',
            },
          },
        ],
      },
    ];

    workflows.forEach(workflow => {
      this.workflows.set(workflow.id, workflow);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}