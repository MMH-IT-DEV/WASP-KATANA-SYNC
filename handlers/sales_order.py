from wasp_api import WaspClient
from slack_notify import send_slack_notification

def handle_sales_order_delivered(data):
    """
    Handle Katana sales_order.delivered webhook
    Logic: Decrement inventory in WASP for each line item delivered
    """
    client = WaspClient()
    order_id = data.get("id")
    line_items = data.get("line_items", [])
    
    summary_results = []
    
    for item in line_items:
        sku = item.get("sku")
        qty = item.get("quantity")
        
        if not sku or not qty:
            continue
            
        status_code, res = client.remove_item_transaction(sku, qty)
        
        if status_code == 200:
            summary_results.append(f"✅ {sku}: removed {qty}")
        else:
            error_msg = res.get("Message", "Unknown error")
            summary_results.append(f"❌ {sku}: failed ({error_msg})")
            
    notification_body = f"📦 *Sales Order Delivered: {order_id}*\n" + "\n".join(summary_results)
    send_slack_notification(notification_body)
    
    return {"status": "processed", "results": summary_results}
