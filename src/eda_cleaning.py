import pandas as pd
import numpy as np

print("========================================")
print("ANALYZING DATASET 1 (Parking Violations)")
print("========================================")
df1 = pd.read_csv('1.csv')
print(f"Original Shape: {df1.shape}")

# Data Cleaning for PS1
# Convert dates
df1['created_datetime'] = pd.to_datetime(df1['created_datetime'], errors='coerce')
# Missing values
missing1 = df1.isnull().mean() * 100
print("\nMissing Values % (>0):")
print(missing1[missing1 > 0].sort_values(ascending=False))

# Drop columns with > 90% missing values
cols_to_drop_1 = missing1[missing1 > 90].index.tolist()
df1_clean = df1.drop(columns=cols_to_drop_1)
print(f"\nShape after dropping high-null columns: {df1_clean.shape}")

# Temporal spread
print(f"\nDate Range: {df1_clean['created_datetime'].min()} to {df1_clean['created_datetime'].max()}")
print(f"Total days: {(df1_clean['created_datetime'].max() - df1_clean['created_datetime'].min()).days}")

# Spatial spread
unique_locations = df1_clean['location'].nunique()
unique_junctions = df1_clean['junction_name'].nunique()
print(f"Unique Locations: {unique_locations}")
print(f"Unique Junctions: {unique_junctions}")
print(f"Unique Vehicle Types: {df1_clean['vehicle_type'].nunique()}")


print("\n========================================")
print("ANALYZING DATASET 2 (Event-Driven Congestion)")
print("========================================")
df2 = pd.read_csv('2.csv')
print(f"Original Shape: {df2.shape}")

# Data Cleaning for PS2
df2['start_datetime'] = pd.to_datetime(df2['start_datetime'], errors='coerce')
missing2 = df2.isnull().mean() * 100
print("\nMissing Values % (>0):")
print(missing2[missing2 > 0].sort_values(ascending=False))

cols_to_drop_2 = missing2[missing2 > 90].index.tolist()
df2_clean = df2.drop(columns=cols_to_drop_2)
print(f"\nShape after dropping high-null columns: {df2_clean.shape}")

print(f"\nDate Range: {df2_clean['start_datetime'].min()} to {df2_clean['start_datetime'].max()}")
if pd.notnull(df2_clean['start_datetime'].min()) and pd.notnull(df2_clean['start_datetime'].max()):
    print(f"Total days: {(df2_clean['start_datetime'].max() - df2_clean['start_datetime'].min()).days}")

unique_causes = df2_clean['event_cause'].nunique()
print(f"Unique Event Causes: {unique_causes}")
print("Top Event Causes:")
print(df2_clean['event_cause'].value_counts().head())

# Look at target variable potential for PS2
print("\nTarget Variable Potential for PS2:")
print(f"Requires Road Closure distribution:\n{df2_clean['requires_road_closure'].value_counts(normalize=True)*100}")
if 'priority' in df2_clean.columns:
    print(f"Priority distribution:\n{df2_clean['priority'].value_counts(normalize=True)*100}")

