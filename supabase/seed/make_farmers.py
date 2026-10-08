"""
builds the farmer roster for supabase/seed/farmers_from_app.sql and the portraits in public/farmers/.
    python3 supabase/seed/make_farmers.py
everything is made up: names, phones and cnic numbers are random, the pictures are drawn.
"""
import json, random, sys
from pathlib import Path

R = random.Random(20261008)
ROOT = Path(__file__).resolve().parents[2]

CITIES = {
    'Lahore':     (31.52, 74.36, '35202', ['Manga Mandi', 'Raiwind', 'Bedian', 'Kahna Nau', 'Barki', 'Chung', 'Jallo', 'Hadiara', 'Lidhar', 'Sundar']),
    'Faisalabad': (31.42, 73.08, '33100', ['Chak 208 RB', 'Chak 7 JB Dhandra', 'Khurrianwala', 'Chak 61 JB', 'Chak 235 RB', 'Jhumra', 'Chak 224 RB', 'Lundianwala', 'Satiana', 'Chak 97 GB']),
    'Sialkot':    (32.49, 74.53, '34603', ['Sambrial', 'Daska', 'Pasrur', 'Ugoki', 'Gohadpur', 'Kotli Loharan', 'Chawinda', 'Begowala', 'Bhopalwala', 'Kapoorwali']),
    'Islamabad':  (33.68, 73.05, '61101', ['Tarlai', 'Bhara Kahu', 'Alipur Farash', 'Sihala', 'Shah Allah Ditta', 'Golra Sharif', 'Tarnol', 'Koral', 'Rawat', 'Chirah']),
    'Rawalpindi': (33.60, 73.04, '37405', ['Chakri', 'Adiala', 'Chak Beli Khan', 'Kallar Syedan', 'Gujar Khan', 'Dhamial', 'Morgah', 'Jhatta Hathial', 'Chountra', 'Bagga Sheikhan']),
    'Multan':     (30.20, 71.47, '36302', ['Shujabad', 'Qadirpur Raan', 'Makhdoom Rasheed', 'Basti Malook', 'Mouza Bosan', 'Sher Shah', 'Bahadurpur', 'Jalalpur Pirwala', 'Matital', 'Muzaffarabad']),
    'Gujranwala': (32.16, 74.19, '34101', ['Kamoke', 'Eminabad', 'Nowshera Virkan', 'Qila Didar Singh', 'Ladhewala Warraich', 'Wazirabad', 'Aroop', 'Kot Ladha', 'Rahwali', 'Ali Pur Chatha']),
}
MEN = ['Muhammad Aslam', 'Ghulam Rasool', 'Allah Ditta', 'Muhammad Ashraf', 'Rana Tariq Mehmood', 'Chaudhry Nadeem Ahmad', 'Malik Shahid Iqbal',
       'Abdul Ghafoor', 'Muhammad Riaz', 'Zulfiqar Ali', 'Sajid Mehmood', 'Naveed Anjum', 'Imtiaz Hussain', 'Bashir Ahmad', 'Khadim Hussain',
       'Muhammad Yousaf', 'Mushtaq Ahmad', 'Ijaz Ahmad', 'Shaukat Ali', 'Akhtar Abbas', 'Liaqat Ali', 'Irfan Haider', 'Faisal Javed',
       'Nasir Mehmood', 'Amjad Ali', 'Zafar Iqbal', 'Arshad Mahmood', 'Tanveer Ahmad', 'Rizwan Ashraf', 'Sarfraz Khan', 'Ghulam Mustafa',
       'Manzoor Hussain', 'Abdul Rasheed', 'Mehboob Alam', 'Qaiser Abbas', 'Rana Javed Iqbal', 'Malik Asghar Ali', 'Haji Muhammad Saleem',
       'Jamshed Iqbal', 'Hafiz Muhammad Usman', 'Kashif Nawaz', 'Atif Shahzad', 'Muhammad Nawaz Gondal', 'Ahmad Raza', 'Abid Hussain',
       'Sultan Ahmad', 'Fazal Din', 'Noor Muhammad', 'Raja Khalid Mehmood', 'Sardar Ali', 'Ehsan Ullah', 'Zahid Hussain', 'Shafqat Ali',
       'Rehmat Ali', 'Mumtaz Ali Bhatti', 'Babar Ali', 'Usman Ghani', 'Saeed Akhtar', 'Asif Iqbal Cheema', 'Tahir Mehmood Warraich']
WOMEN = ['Rasheeda Bibi', 'Nasreen Akhtar', 'Shamim Bibi', 'Parveen Kausar', 'Zubaida Begum', 'Kalsoom Bibi', 'Naseem Akhtar',
         'Sughra Bibi', 'Fatima Bibi', 'Robina Kausar', 'Shahnaz Begum']
FARMS = ['{s} Dairy Farm', '{s} Cattle Farm', 'Bismillah Dairy', 'Madni Dairy Farm', 'Al-Rehman Cattle Farm', 'Barkat Dairy', 'Noor Dairy Farm',
         'Chaudhry Cattle Farm', 'Sabir Dairy', 'Green Valley Dairy']
NOTES = ['Animals are milked twice a day, morning and evening.', 'All animals are vaccinated for FMD and HS every season.',
         'Green fodder (barseem and maize) grown on my own land.', 'Milk is kept in steel cans, never plastic.',
         'Family farm, my sons help with milking.', 'Looking for a center that pays every week.',
         'Can deliver to the center myself on motorcycle.', 'Nili-Ravi buffaloes, good fat content.', 'Sahiwal cows, milk sold fresh within two hours.',
         'Ready to bring milk at 6 am every day.']
REJECT = ['The picture is not clear. Please take a new photo in daylight showing your face.',
          'The phone number could not be verified. Please check it and send your details again.',
          'Your address is incomplete. Add your village and the nearest landmark.']

def phone():
    return f"03{R.choice(['00','01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','21','22','23','33','34','35','36','42','45','46','47'])}{R.randint(1000000, 9999999)}"

def main():
    men, women = MEN[:], WOMEN[:]
    R.shuffle(men); R.shuffle(women)
    used_phones, out, n = set(), [], 0
    for city, (lat, lng, code, villages) in CITIES.items():
        vs = villages[:]; R.shuffle(vs)
        for i in range(10):
            n += 1
            female = (n % 7 == 3) and women
            name = women.pop() if female else men.pop()
            age = R.randint(24, 68)
            p = phone()
            while p in used_phones: p = phone()
            used_phones.add(p)
            milk = R.choices(['buffalo', 'mixed', 'cow'], [55, 25, 20])[0]
            cattle = R.choice([2, 3, 4, 5, 6, 6, 8, 10, 12, 15, 18, 22, 30])
            per = {'buffalo': 7, 'cow': 10, 'mixed': 8}[milk]
            litres = round(cattle * per * R.uniform(0.55, 0.8))
            surname = name.split()[-1]
            village = vs[i]
            status = 'active' if i < 6 else 'rejected' if (i == 9 and city in ('Lahore', 'Multan', 'Rawalpindi')) else 'pending'
            out.append({
                'slug': f"f{n:02d}", 'full_name': name, 'female': bool(female), 'age': age, 'phone': p,
                'cnic': f"{code}-{R.randint(1000000, 9999999)}-{R.choice([2,4,6,8]) if female else R.choice([1,3,5,7,9])}",
                'city': city, 'village': village,
                'address': R.choice(['Near Jamia Masjid', 'Main bazaar road', 'Near government school', 'Behind the union council office',
                                     'Street 2, near the canal bridge', 'Near the BHU dispensary', 'Dera next to the tube well']) + f", {village}",
                'lat': round(lat + R.uniform(-0.12, 0.12), 5), 'lng': round(lng + R.uniform(-0.12, 0.12), 5),
                'farm_name': R.choice(FARMS).format(s=surname) if R.random() < 0.45 else None,
                'milk_type': milk, 'cattle': cattle, 'litres': litres, 'notes': R.choice(NOTES) if R.random() < 0.7 else None,
                'status': status, 'reject_reason': R.choice(REJECT) if status == 'rejected' else None,
                # hours ago: joined, sent details, approved
                'joined_h': R.randint(240, 720) if status == 'active' else R.randint(60, 140) if status == 'rejected' else R.randint(2, 70),
            })
    for f in out:
        f['sent_h'] = f['joined_h'] - R.randint(0, 6) * 0 - R.uniform(0.1, 3)
        f['approved_h'] = f['sent_h'] - R.uniform(20, 160) if f['status'] == 'active' else f['sent_h'] - R.uniform(5, 30) if f['status'] == 'rejected' else None
        f['seed'] = R.randint(1, 10**9)
    (ROOT / 'supabase' / 'seed' / 'farmers.json').write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(len(out), 'farmers', {s: sum(f['status'] == s for f in out) for s in ('active', 'pending', 'rejected')},
          'women', sum(f['female'] for f in out))

if __name__ == '__main__':
    main()
