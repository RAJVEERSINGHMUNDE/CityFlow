import sys, os
import pandas as pd
sys.path.append('src/simulator')
from realtime_feed import init_feed, get_feed
# Load dataset
DATA_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), 'dataset/2.csv'))
if not os.path.exists(DATA_PATH):
    DATA_PATH = r"d:\\CODE\\Python\\AIML\\CityFlow\\dataset\\2.csv"

df = pd.read_csv(DATA_PATH)
init_feed(df)
feed = get_feed()
if not feed:
    print('Feed not initialized')
else:
    as_of = pd.Timestamp('2024-03-07T18:30:00')
    incidents = feed.get_active_incidents(as_of.to_pydatetime())
    print('Incidents count:', len(incidents))
    if incidents:
        print('First incident:', incidents[0])
