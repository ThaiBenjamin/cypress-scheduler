import requests
import json
import sys

# The exact URL you found! 
# (Note: I removed the "?p=..." at the end because that is just a cache-buster the browser uses. The clean URL works perfectly!)
URL = "https://schedule.nocccd.edu/data/202530/sections.json"

def scrape_classes():
    print("🚀 Starting NOCCCD Direct Download Scraper...")
    
    # We pretend to be a normal Google Chrome browser so the school's firewall doesn't block us
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
    }
    
    try:
        print(f"📡 Downloading class data directly from NOCCCD servers...")
        response = requests.get(URL, headers=headers)
        
        if response.status_code != 200:
            print(f"❌ Failed to download data. The school's server returned: {response.status_code}")
            sys.exit(1)
            
        # Parse the data we just downloaded
        raw_data = response.json()
        
        # Because this file might contain BOTH Cypress and Fullerton classes, 
        # let's try to filter it. (Usually, there is a 'college' or 'campus' key).
        # If we aren't sure of the exact key yet, we will just save the whole thing for now!
        print(f"✅ Successfully downloaded {len(raw_data)} total classes across the district!")
        
        # Save it to the file so your seed.ts script can read it
        with open('cypress_data.json', 'w', encoding='utf-8') as file:
            json.dump(raw_data, file, indent=4)
            
        print("💾 Saved live data to cypress_data.json. Ready for database injection!")
        
    except Exception as e:
        print(f"❌ A critical error occurred: {e}")
        sys.exit(1)

if __name__ == "__main__":
    scrape_classes()