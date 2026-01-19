# Katana-WASP Sync Service

A Flask-based integration service that listens to Katana webhooks and updates WASP Inventory Cloud.

## Project Structure

- `app.py`: Main Flask application entry point.
- `config.py`: Environment configuration loader.
- `wasp_api.py`: WASP Inventory API client.
- `slack_notify.py`: Slack notification utility.
- `handlers/`: logic for different webhook events.
  - `sales_order.py`: Handles `sales_order.delivered`.
  - `inventory.py`: Handles inventory updates.

## Setup

1. Copy `.env.example` to `.env` and fill in the values.
2. Install dependencies: `pip install -r requirements.txt`
3. Run the app: `python app.py`

## Endpoints

- `GET /health`: Check service status.
- `POST /webhooks/katana/sales-order-delivered`: Katana Sales Order Delivered webhook.
- `POST /webhooks/katana/inventory-update`: Katana Inventory Update webhook.
