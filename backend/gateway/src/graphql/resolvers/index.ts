import { authResolvers } from './auth';
import { userResolvers } from './user';
import { reskflowResolvers } from './reskflow';
import { paymentResolvers } from './payment';
import { subscriptionResolvers } from './subscription';
import { GraphQLDateTime, GraphQLJSON } from 'graphql-scalars';

export const resolvers = {
  DateTime: GraphQLDateTime,
  JSON: GraphQLJSON,
  Query: {
    ...authResolvers.Query,
    ...userResolvers.Query,
    ...reskflowResolvers.Query,
    ...paymentResolvers.Query,
  },
  Mutation: {
    ...authResolvers.Mutation,
    ...userResolvers.Mutation,
    ...reskflowResolvers.Mutation,
    ...paymentResolvers.Mutation,
  },
  Subscription: {
    ...subscriptionResolvers.Subscription,
  },
  User: userResolvers.User,
  Delivery: reskflowResolvers.Delivery,
  Payment: paymentResolvers.Payment,
};