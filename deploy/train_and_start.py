#!/usr/bin/env python3
"""Pre-train NLP model synchronously, then start the Flask API."""
import sys, os

os.chdir('/root/CityFlow')
sys.path.insert(0, '/root/CityFlow/src/simulator')

from nlp_impact import get_nlp_classifier
from data_pipeline import DataPipeline

p = DataPipeline('dataset/2.csv')
p.load_and_clean_data()
print('Pipeline ready, training NLP...')
get_nlp_classifier().fit(p.df)
print('NLP trained!')

# Now start the API (this will load the cached graph + train severity/survival in background)
os.system('python3 src/api/app.py')
