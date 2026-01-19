import requests
import json
from config import Config

class WaspClient:
    def __init__(self):
        self.base_url = Config.WASP_BASE_URL
        self.token = Config.WASP_TOKEN
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }

    def inventory_search(self, item_number=None):
        """Search for inventory items"""
        url = f"{self.base_url}/public-api/ic/item/inventorysearch"
        payload = {"searchFilter": {}}
        if item_number:
            payload["searchFilter"]["ItemNumber"] = item_number
            
        response = requests.post(url, headers=self.headers, json=payload)
        return response.json()

    def add_item_transaction(self, item_number, quantity, site_name="Warehouse 1", location_code="A1"):
        """Perform an 'Add Item' transaction"""
        url = f"{self.base_url}/public-api/transactions/item/add"
        payload = [{
            "ItemNumber": item_number,
            "Quantity": quantity,
            "SiteName": site_name,
            "LocationCode": location_code
        }]
        
        response = requests.post(url, headers=self.headers, json=payload)
        return response.status_code, response.json()

    def remove_item_transaction(self, item_number, quantity, site_name="Warehouse 1", location_code="A1"):
        """Perform a 'Remove Item' transaction"""
        url = f"{self.base_url}/public-api/transactions/item/remove"
        payload = [{
            "ItemNumber": item_number,
            "Quantity": quantity,
            "SiteName": site_name,
            "LocationCode": location_code
        }]
        
        response = requests.post(url, headers=self.headers, json=payload)
        return response.status_code, response.json()
