import requests
import json
import sys

# The Master List of Semesters
TERMS = [
    {
        "name": "2026-Summer", 
        "url": "https://schedule.nocccd.edu/data/202530/sections.json"
    },
    {
        "name": "2026-Fall", 
        "url": "https://schedule.nocccd.edu/data/202610/sections.json" 
    }
]

def scrape_classes():
    print("🚀 Starting NOCCCD Multi-Term Scraper...")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
    }
    
    all_classes = []

    try:
        # Loop through every term in our list
        for term in TERMS:
            print(f"📡 Downloading {term['name']} data...")
            
            # Notice how it uses term["url"] here instead of the old URL variable!
            response = requests.get(term["url"], headers=headers)
            
            if response.status_code == 200:
                raw_data = response.json()
                
                # INJECTION: Stamp every class with our custom term name so the database knows what it is!
                for course in raw_data:
                    course["my_custom_term"] = term["name"]
                    
                all_classes.extend(raw_data)
                print(f"✅ Successfully downloaded {len(raw_data)} classes for {term['name']}!")
            else:
                print(f"❌ Failed to download {term['name']}. Server returned: {response.status_code}")

        # Save all the combined semesters into one massive file
        with open('cypress_data.json', 'w', encoding='utf-8') as file:
            json.dump(all_classes, file, indent=4)
            
        print(f"💾 Saved {len(all_classes)} TOTAL classes to cypress_data.json. Ready for injection!")
        
    except Exception as e:
        print(f"❌ A critical error occurred: {e}")
        sys.exit(1)

if __name__ == "__main__":
    scrape_classes()