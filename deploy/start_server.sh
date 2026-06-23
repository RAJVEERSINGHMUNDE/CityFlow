#!/bin/bash
set -e
cd /root/CityFlow
source .venv/bin/activate

# Clean up
rm -f nlp_model.pkl
fuser -k 8000/tcp 2>/dev/null || true
sleep 2

echo "=== Pre-training NLP model ==="
python3 -c "
import sys
sys.path.insert(0, 'src/simulator')
from nlp_impact import get_nlp_classifier
from data_pipeline import DataPipeline
p = DataPipeline('dataset/2.csv')
p.load_and_clean_data()
print('Pipeline ready, training NLP...')
get_nlp_classifier().fit(p.df)
print('NLP trained!')
"

echo "=== NLP done, starting API ==="
nohup python3 src/api/app.py > /root/cityflow.log 2>&1 &
echo "API PID: $!"
echo "Log: tail -f /root/cityflow.log"
