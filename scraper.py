import requests
import json
import sys

TERMS = [
    {
        "name": "2026-Summer", 
        "url": "https://schedule.nocccd.edu/data/202530/sections.json"
    },
    {
        "name": "2026-Fall", 
        # You can drop the "?p=..." cache buster at the end, the clean URL is perfect!
        "url": "https://schedule.nocccd.edu/data/202610/sections.json" 
    }
]

def scrape_classes():
    print("🚀 Starting NOCCCD Direct Download Scraper...")
    
    # We pretend to be a normal browser so the school's firewall doesn't block us
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
    }
    
    try:
        print(f"📡 Downloading class data directly from NOCCCD servers...")
        response = requests.get(URL, headers=headers)
        
        if response.status_code != 200:
            print(f"❌ Failed to download data. Server returned: {response.status_code}")
            sys.exit(1)
            
        # Parse the downloaded data
        raw_data = response.json()
        print(f"✅ Successfully downloaded {len(raw_data)} total classes!")
        
        # Save it to the file so your seed.ts script can read it
        with open('cypress_data.json', 'w', encoding='utf-8') as file:
            json.dump(raw_data, file, indent=4)
            
        print("💾 Saved live data to cypress_data.json. Ready for database injection!")
        
    except Exception as e:
        print(f"❌ A critical error occurred: {e}")
        sys.exit(1)

if __name__ == "__main__":
    scrape_classes()
