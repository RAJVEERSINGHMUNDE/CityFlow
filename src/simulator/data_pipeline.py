import pandas as pd
import numpy as np
import os

class DataPipeline:
    def __init__(self, data_path: str):
        self.data_path = data_path
        self.df = None

    def load_and_clean_data(self) -> pd.DataFrame:
        """
        Loads the 2.csv event dataset and cleans it by handling missing values
        and extracting meaningful features.
        Includes BOTH planned and unplanned events to fully address PS2 scope.
        """
        print(f"Loading data from {self.data_path}...")
        self.df = pd.read_csv(self.data_path)

        # 1. Filter out rows without valid coordinates (Crucial for simulation)
        self.df = self.df.dropna(subset=['latitude', 'longitude'])

        # 2. Convert start_datetime to proper datetime objects
        self.df['start_datetime'] = pd.to_datetime(self.df['start_datetime'], errors='coerce')
        self.df = self.df.dropna(subset=['start_datetime'])

        # 3. Fill missing event causes with 'unknown'
        self.df['event_cause'] = self.df['event_cause'].fillna('unknown')

        # 4. Include ALL events (planned + unplanned) — PS2 covers both types.
        #    Sort: planned events first (proactive value), then unplanned.
        planned = self.df[self.df['event_type'] == 'planned']
        unplanned = self.df[self.df['event_type'] == 'unplanned']
        self.df = pd.concat([unplanned, planned]).reset_index(drop=True)

        print(f"Data cleaned. Total valid events: {len(self.df)} "
              f"({len(unplanned)} unplanned, {len(planned)} planned)")
        return self.df

    def get_demo_event(self) -> dict:
        """
        Selects a prominent event to act as the simulation epicenter.
        Prioritizes unplanned 'vehicle_breakdown' or 'construction' that require road closure.
        """
        if self.df is None:
            self.load_and_clean_data()

        # Try to find a severe event that requires road closure
        severe_events = self.df[self.df['requires_road_closure'] == True]

        if len(severe_events) > 0:
            demo_event = severe_events.iloc[0]
        else:
            demo_event = self.df.iloc[0]

        return {
            'id': demo_event['id'],
            'latitude': demo_event['latitude'],
            'longitude': demo_event['longitude'],
            'cause': demo_event['event_cause'],
            'time': demo_event['start_datetime'],
            'event_type': demo_event.get('event_type', 'unplanned'),
        }

    def get_top_events(self, n: int = 50) -> list:
        """
        Returns the top N events, prioritizing those requiring road closures.
        Includes both planned and unplanned events.
        """
        if self.df is None:
            self.load_and_clean_data()

        # Prioritize severe events requiring closure
        severe = self.df[self.df['requires_road_closure'] == True]
        others = self.df[self.df['requires_road_closure'] == False]

        top_df = pd.concat([severe, others]).head(n)

        events = []
        for _, row in top_df.iterrows():
            # Duration in hours if column exists
            duration_hours = None
            if 'duration_hours' in row and pd.notna(row['duration_hours']):
                try:
                    duration_hours = float(row['duration_hours'])
                except (ValueError, TypeError):
                    pass

            events.append({
                'id': str(row['id']),
                'cause': str(row['event_cause']).replace('_', ' ').title(),
                'latitude': float(row['latitude']),
                'longitude': float(row['longitude']),
                'requires_closure': bool(row['requires_road_closure']),
                'time': str(row['start_datetime']),
                'event_type': str(row.get('event_type', 'unplanned')),
                'duration_hours': duration_hours,
            })
        return events

if __name__ == "__main__":
    # Ensure correct path whether run from root or src directory
    dataset_path = "../../dataset/2.csv"
    if not os.path.exists(dataset_path):
        dataset_path = r"d:\CODE\Python\AIML\CityFlow\dataset\2.csv"

    pipeline = DataPipeline(dataset_path)
    clean_df = pipeline.load_and_clean_data()

    demo_event = pipeline.get_demo_event()
    print("\nSelected Demo Event for Simulation:")
    print(demo_event)
