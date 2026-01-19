import requests
from config import Config

def send_slack_notification(message):
    """Send a message to Slack via Webhook"""
    if not Config.SLACK_WEBHOOK_URL:
        print(f"Slack notification (dry run): {message}")
        return
        
    payload = {"text": message}
    try:
        response = requests.post(Config.SLACK_WEBHOOK_URL, json=payload)
        response.raise_for_status()
    except Exception as e:
        print(f"Failed to send Slack notification: {e}")
