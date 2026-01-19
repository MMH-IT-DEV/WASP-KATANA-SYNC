import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # WASP API Settings
    WASP_BASE_URL = os.getenv("WASP_BASE_URL", "https://mymagichealer.waspinventorycloud.com")
    WASP_TOKEN = os.getenv("WASP_TOKEN")
    
    # Slack Settings
    SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL")
    
    # App Settings
    PORT = int(os.getenv("PORT", 5000))
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"
    
    # Katana Settings (for future verification)
    KATANA_API_KEY = os.getenv("KATANA_API_KEY")
