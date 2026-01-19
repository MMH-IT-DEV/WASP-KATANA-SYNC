from flask import Flask, request, jsonify
from config import Config
from handlers.sales_order import handle_sales_order_delivered
from handlers.inventory import handle_inventory_update

app = Flask(__name__)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy"}), 200

@app.route("/webhooks/katana/sales-order-delivered", methods=["POST"])
def sales_order_delivered():
    data = request.json
    if not data:
        return jsonify({"error": "No data version"}), 400
        
    result = handle_sales_order_delivered(data)
    return jsonify(result), 200

@app.route("/webhooks/katana/inventory-update", methods=["POST"])
def inventory_update():
    data = request.json
    result = handle_inventory_update(data)
    return jsonify(result), 200

if __name__ == "__main__":
    app.run(port=Config.PORT, debug=Config.DEBUG)
