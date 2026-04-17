import requests
import json
import sys

# The Master List of Semesters
TERMS = [
    {
        "name": "2026-Summer", 
        "sections_url": "https://schedule.nocccd.edu/data/202530/sections.json",
        "courses_url": "https://schedule.nocccd.edu/data/202530/courses.json"
    },
    {
        "name": "2026-Fall", 
        "sections_url": "https://schedule.nocccd.edu/data/202610/sections.json",
        "courses_url": "https://schedule.nocccd.edu/data/202610/courses.json"
    }
]

def scrape_classes():
    print("🚀 Starting NOCCCD Full-Stack Scraper (Schedule + Catalog)...")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
    }
    
    all_classes = []

    try:
        # Loop through every term in our list
        for term in TERMS:
            print(f"\n📡 Fetching Catalog (Titles/Units) for {term['name']}...")
            catalog_response = requests.get(term["courses_url"], headers=headers)
            catalog_dict = {}
            
            # 1. BUILD THE DICTIONARY
            if catalog_response.status_code == 200:
                catalog_data = catalog_response.json()
                for course in catalog_data:
                    # Create a bulletproof ID by stripping spaces (e.g. "AC/R" + "100 C" = "AC/R100C")
                    subj = str(course.get("crseSubjCode", "")).replace(" ", "").upper()
                    numb = str(course.get("crseCrseNumb", "")).replace(" ", "").upper()
                    unique_id = subj + numb
                    
                    catalog_dict[unique_id] = {
                        "title": course.get("crseTitle", "Title TBA"),
                        "units": course.get("crseCredHrLow", 0)
                    }
                print(f"✅ Built Catalog Dictionary with {len(catalog_dict)} master courses.")
            else:
                print(f"⚠️ Could not load catalog for {term['name']}.")

            # 2. DOWNLOAD THE SCHEDULE AND STITCH THEM TOGETHER
            print(f"📡 Fetching Schedule (Times/Seats) for {term['name']}...")
            sections_response = requests.get(term["sections_url"], headers=headers)
            
            if sections_response.status_code == 200:
                sections_data = sections_response.json()
                cypress_count = 0
                
                for section in sections_data:
                    
                    # THE FIX: Strip spaces and check BOTH the start and end for a "C"!
                    course_num_raw = str(section.get("sectCrseNumb", ""))
                    clean_num = course_num_raw.replace(" ", "").upper()
                    
                    if clean_num.endswith("C") or clean_num.startswith("C"):
                        
                        # Find the matching title and units from our dictionary
                        subj = str(section.get("sectSubjCode", "")).replace(" ", "").upper()
                        lookup_id = subj + clean_num
                        
                        # Grab the real data, or default to TBD if the school made a typo
                        catalog_info = catalog_dict.get(lookup_id, {"title": "Title TBA", "units": 0})
                        
                        # INJECT the combined data into the final object!
                        section["my_custom_term"] = term["name"]
                        section["my_custom_title"] = catalog_info["title"]
                        section["my_custom_units"] = catalog_info["units"]
                        
                        all_classes.append(section)
                        cypress_count += 1
                        
                print(f"✅ Successfully matched and combined {cypress_count} complete Cypress classes!")
            else:
                print(f"❌ Failed to download schedule for {term['name']}.")

        # Save all the stitched-together classes into one massive file
        with open('cypress_data.json', 'w', encoding='utf-8') as file:
            json.dump(all_classes, file, indent=4)
            
        print(f"\n💾 Saved {len(all_classes)} TOTAL perfect classes. Ready for injection!")
        
    except Exception as e:
        print(f"❌ A critical error occurred: {e}")
        sys.exit(1)

if __name__ == "__main__":
    scrape_classes()
