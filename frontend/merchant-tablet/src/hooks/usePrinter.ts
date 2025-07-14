import { useCallback } from 'react';

export function usePrinter() {
  const printOrder = useCallback((order: any) => {
    const printContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { font-size: 24px; margin-bottom: 10px; }
            h2 { font-size: 18px; margin-bottom: 8px; }
            .header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
            .item { margin-bottom: 8px; padding: 5px 0; }
            .modifiers { margin-left: 20px; font-size: 14px; color: #666; }
            .total { border-top: 2px solid #000; padding-top: 10px; margin-top: 10px; font-weight: bold; }
            .info { margin-bottom: 5px; }
            @media print {
              body { margin: 0; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Order #${order.orderNumber}</h1>
            <div class="info">Type: ${order.type}</div>
            <div class="info">Time: ${new Date(order.createdAt).toLocaleString()}</div>
          </div>
          
          <div class="customer">
            <h2>Customer</h2>
            <div class="info">${order.customer.name}</div>
            <div class="info">${order.customer.phone}</div>
            ${order.reskflowAddress ? `
              <div class="info">${order.reskflowAddress.street}</div>
              <div class="info">${order.reskflowAddress.city}, ${order.reskflowAddress.state} ${order.reskflowAddress.zip}</div>
            ` : ''}
          </div>
          
          <div class="items">
            <h2>Items</h2>
            ${order.items.map((item: any) => `
              <div class="item">
                <strong>${item.quantity}x ${item.menuItem.name}</strong> - $${item.totalPrice.toFixed(2)}
                ${item.modifiers?.length > 0 ? `
                  <div class="modifiers">
                    ${item.modifiers.map((mod: any) => mod.modifierName).join(', ')}
                  </div>
                ` : ''}
                ${item.specialRequest ? `
                  <div class="modifiers">Note: ${item.specialRequest}</div>
                ` : ''}
              </div>
            `).join('')}
          </div>
          
          <div class="total">
            <div class="info">Subtotal: $${order.subtotal.toFixed(2)}</div>
            <div class="info">Tax: $${order.tax.toFixed(2)}</div>
            <div class="info">Delivery: $${order.reskflowFee.toFixed(2)}</div>
            ${order.tip > 0 ? `<div class="info">Tip: $${order.tip.toFixed(2)}</div>` : ''}
            <div class="info" style="font-size: 20px;">Total: $${order.total.toFixed(2)}</div>
          </div>
          
          ${order.instructions ? `
            <div class="instructions">
              <h2>Instructions</h2>
              <p>${order.instructions}</p>
            </div>
          ` : ''}
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }
  }, []);

  const printDailySummary = useCallback((summary: any) => {
    // Implementation for daily summary printing
    console.log('Printing daily summary', summary);
  }, []);

  return {
    printOrder,
    printDailySummary,
  };
}