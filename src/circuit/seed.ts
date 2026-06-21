// Real Circuit history snapshot for the whole group. The Supabase cloud is the source of
// truth; this file is the generator source for publicSeed.ts (and a local-dev fallback).
// Nothing in the app imports it, so it is tree-shaken out of the client bundle.
import type { CircuitState } from './types'

export const circuitSeed: CircuitState = {
  people: [
    {
      id: '1',
      name: 'Josh',
      color: '#f5c842',
      goal: 100,
      exercises: [
        {
          id: '1',
          name: 'Pushups',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 0,
        },
        {
          id: '2',
          name: 'Core',
          unit: 'reps',
          mult: 1,
          cat: 'core',
          col: 1,
          row: 0,
        },
        {
          id: '3',
          name: 'Legs',
          unit: 'reps',
          mult: 1,
          cat: 'legs',
          col: 2,
          row: 0,
        },
        {
          id: '4',
          name: 'Weights',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 1,
        },
        {
          id: '5',
          name: 'Pullups',
          unit: 'reps',
          mult: 2,
          cat: 'arms',
          col: 0,
          row: 2,
        },
        {
          id: '6',
          name: 'Bike km',
          unit: 'km',
          mult: 4,
          cat: 'bike',
          col: 3,
          row: 0,
        },
        {
          id: '7',
          name: 'Blade km',
          unit: 'km',
          mult: 7,
          cat: 'skate',
          col: 4,
          row: 0,
        },
        {
          id: '8',
          name: 'Run km',
          unit: 'km',
          mult: 20,
          cat: 'run',
          col: 5,
          row: 0,
        },
      ],
      colLabels: ['Arms', 'Core', 'Legs', 'Bike', 'Skate', 'Run'],
    },
    {
      id: '2',
      name: 'Evan',
      color: '#7c6af7',
      goal: 100,
      exercises: [
        {
          id: '1',
          name: 'Pullups',
          unit: 'reps',
          mult: 2,
          cat: 'arms',
          col: 0,
          row: 0,
        },
        {
          id: '2',
          name: 'Pushups',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 1,
        },
        {
          id: '3',
          name: 'Core / Plank',
          unit: 'min',
          mult: 10,
          cat: 'core',
          col: 1,
          row: 0,
        },
        {
          id: '4',
          name: 'Weights',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 2,
        },
        {
          id: '5',
          name: 'Miles ran',
          unit: 'mi',
          mult: 32,
          cat: 'run',
          col: 2,
          row: 0,
        },
        {
          id: '6',
          name: 'Miles walked',
          unit: 'mi',
          mult: 16,
          cat: 'walk',
          col: 3,
          row: 0,
        },
        {
          id: '7',
          name: 'Legs',
          unit: 'reps',
          mult: 1,
          cat: 'legs',
          col: 4,
          row: 0,
        },
      ],
      colLabels: ['Arms', 'Core', 'Run', 'Walk', 'Legs'],
    },
    {
      id: '3',
      name: 'Cam',
      color: '#2ecc8a',
      goal: 100,
      exercises: [
        {
          id: '1',
          name: 'Stretch',
          unit: 'sets',
          mult: 5,
          cat: 'other',
          col: 0,
          row: 0,
        },
        {
          id: '2',
          name: 'Weights',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 1,
          row: 0,
        },
        {
          id: '3',
          name: 'Push ups',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 1,
          row: 1,
        },
        {
          id: '4',
          name: 'km run',
          unit: 'km',
          mult: 20,
          cat: 'run',
          col: 2,
          row: 0,
        },
      ],
      colLabels: ['Other', 'Arms', 'Run'],
    },
    {
      id: '4',
      name: 'Shawn',
      color: '#f46b6b',
      goal: 100,
      exercises: [
        {
          id: '1',
          name: 'Pushups',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 0,
        },
        {
          id: '2',
          name: 'Situps',
          unit: 'reps',
          mult: 1,
          cat: 'core',
          col: 1,
          row: 0,
        },
        {
          id: '3',
          name: 'Curls',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 1,
        },
        {
          id: '4',
          name: 'Leg lifts',
          unit: 'reps',
          mult: 1,
          cat: 'legs',
          col: 2,
          row: 0,
        },
        {
          id: '5',
          name: 'Squats',
          unit: 'reps',
          mult: 1,
          cat: 'legs',
          col: 2,
          row: 1,
        },
        {
          id: '6',
          name: 'Deep stretching',
          unit: 'min',
          mult: 1,
          cat: 'other',
          col: 3,
          row: 0,
        },
        {
          id: '7',
          name: 'Pullups',
          unit: 'reps',
          mult: 2,
          cat: 'arms',
          col: 0,
          row: 2,
        },
        {
          id: '8',
          name: 'Planking',
          unit: 'min',
          mult: 10,
          cat: 'core',
          col: 1,
          row: 1,
        },
        {
          id: '9',
          name: 'Jumping jacks',
          unit: 'reps',
          mult: 0.5,
          cat: 'other',
          col: 3,
          row: 1,
        },
        {
          id: '10',
          name: 'km',
          unit: 'km',
          mult: 20,
          cat: 'run',
          col: 4,
          row: 0,
        },
      ],
      colLabels: ['Arms', 'Core', 'Legs', 'Other', 'Run'],
    },
    {
      id: '5',
      name: 'Mills',
      color: '#fb923c',
      goal: 100,
      exercises: [
        {
          id: '1',
          name: 'Walk min',
          unit: 'min',
          mult: 1,
          cat: 'walk',
          col: 0,
          row: 0,
        },
        {
          id: '2',
          name: 'Biking min',
          unit: 'min',
          mult: 1.5,
          cat: 'bike',
          col: 1,
          row: 0,
        },
        {
          id: '3',
          name: 'Stretch (5min blk)',
          unit: 'blocks',
          mult: 5,
          cat: 'other',
          col: 2,
          row: 0,
        },
        {
          id: '4',
          name: 'Push-ups',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 3,
          row: 0,
        },
        {
          id: '5',
          name: 'Sit-ups',
          unit: 'reps',
          mult: 1,
          cat: 'core',
          col: 4,
          row: 0,
        },
        {
          id: '6',
          name: 'Squats',
          unit: 'reps',
          mult: 1,
          cat: 'legs',
          col: 5,
          row: 0,
        },
        {
          id: '7',
          name: 'Plank',
          unit: 'sec',
          mult: 0.17,
          cat: 'core',
          col: 4,
          row: 1,
        },
      ],
      colLabels: ['Walk', 'Bike', 'Other', 'Arms', 'Core', 'Legs'],
    },
    {
      id: '6',
      name: 'Tin',
      color: '#5b9cf6',
      goal: 100,
      exercises: [
        {
          id: '1',
          name: 'Protein 160g',
          unit: '✓',
          mult: 10,
          cat: 'other',
          col: 0,
          row: 0,
        },
        {
          id: '2',
          name: 'Quad Curl',
          unit: 'reps',
          mult: 1,
          cat: 'legs',
          col: 1,
          row: 0,
        },
        {
          id: '3',
          name: 'Hamstring Curl',
          unit: 'reps',
          mult: 1,
          cat: 'legs',
          col: 1,
          row: 1,
        },
        {
          id: '4',
          name: 'Hip Thrust',
          unit: 'reps',
          mult: 1,
          cat: 'legs',
          col: 1,
          row: 2,
        },
        {
          id: '5',
          name: 'Leg Press',
          unit: 'reps',
          mult: 1,
          cat: 'legs',
          col: 1,
          row: 3,
        },
        {
          id: '6',
          name: 'Curls',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 0,
        },
        {
          id: '7',
          name: 'Pulldown',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 1,
        },
        {
          id: '8',
          name: 'Row',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 2,
        },
        {
          id: '9',
          name: 'Rear Delt',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 3,
        },
        {
          id: '10',
          name: 'Bench Press',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 4,
        },
        {
          id: '11',
          name: 'Fly',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 5,
        },
        {
          id: '12',
          name: 'Tricep Ext',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 6,
        },
        {
          id: '13',
          name: 'Shoulder Press',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 7,
        },
        {
          id: '14',
          name: 'Lateral Raise',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 8,
        },
        {
          id: '15',
          name: 'Situps',
          unit: 'reps',
          mult: 1,
          cat: 'core',
          col: 3,
          row: 0,
        },
        {
          id: '16',
          name: 'Pushups',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 2,
          row: 9,
        },
        {
          id: '17',
          name: 'Run km',
          unit: 'km',
          mult: 20,
          cat: 'run',
          col: 4,
          row: 0,
        },
        {
          id: '18',
          name: 'Bike min',
          unit: 'min',
          mult: 2,
          cat: 'bike',
          col: 5,
          row: 0,
        },
        {
          id: '19',
          name: 'Calf Raise',
          unit: 'reps',
          mult: 0.5,
          cat: 'legs',
          col: 1,
          row: 4,
        },
        {
          id: '20',
          name: 'Stretch min',
          unit: 'min',
          mult: 0.5,
          cat: 'other',
          col: 0,
          row: 1,
        },
        {
          id: '21',
          name: 'Tennis',
          unit: 'sets',
          mult: 30,
          cat: 'other',
          col: 0,
          row: 2,
        },
        {
          id: '22',
          name: 'Steps Walked',
          unit: 'steps',
          mult: 0.005,
          cat: 'walk',
          col: 6,
          row: 0,
        },
        {
          id: '23',
          name: 'Rock Climbing',
          unit: 'sessions',
          mult: 50,
          cat: 'other',
          col: 0,
          row: 3,
        },
      ],
      colLabels: ['Other', 'Legs', 'Arms', 'Core', 'Run', 'Bike', 'Walk'],
    },
    {
      id: '7',
      name: 'Nat',
      color: '#f472b6',
      goal: 100,
      exercises: [
        {
          id: '1',
          name: 'Pushups',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 0,
        },
        {
          id: '2',
          name: 'Crunches',
          unit: 'reps',
          mult: 1,
          cat: 'core',
          col: 1,
          row: 0,
        },
        {
          id: '3',
          name: 'Bench Press',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 1,
        },
        {
          id: '4',
          name: 'Shoulder Press',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 2,
        },
        {
          id: '5',
          name: 'Walk min',
          unit: 'min',
          mult: 1,
          cat: 'walk',
          col: 2,
          row: 0,
        },
        {
          id: '6',
          name: 'Incline DB Bench',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 3,
        },
        {
          id: '7',
          name: 'Seated Shoulder Press',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 4,
        },
        {
          id: '8',
          name: 'Lat Raises',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 5,
        },
        {
          id: '9',
          name: 'Tricep Pushdowns',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 6,
        },
        {
          id: '10',
          name: 'Tricep Extensions',
          unit: 'reps',
          mult: 1,
          cat: 'arms',
          col: 0,
          row: 7,
        },
        {
          id: '11',
          name: 'Incline Walk 2/min',
          unit: 'min',
          mult: 2,
          cat: 'walk',
          col: 2,
          row: 1,
        },
      ],
      colLabels: ['Arms', 'Core', 'Walk'],
    },
  ],
  logs: [
    {
      id: '20250723010',
      personId: '1',
      date: '2025-07-23',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20250723020',
      personId: '2',
      date: '2025-07-23',
      entries: [
        {
          eid: '__total__',
          val: 160,
        },
      ],
    },
    {
      id: '20250723030',
      personId: '3',
      date: '2025-07-23',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250723040',
      personId: '4',
      date: '2025-07-23',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250724010',
      personId: '1',
      date: '2025-07-24',
      entries: [
        {
          eid: '__total__',
          val: 106,
        },
      ],
    },
    {
      id: '20250724030',
      personId: '3',
      date: '2025-07-24',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250724040',
      personId: '4',
      date: '2025-07-24',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20250725010',
      personId: '1',
      date: '2025-07-25',
      entries: [
        {
          eid: '__total__',
          val: 155,
        },
      ],
    },
    {
      id: '20250725020',
      personId: '2',
      date: '2025-07-25',
      entries: [
        {
          eid: '__total__',
          val: 135,
        },
      ],
    },
    {
      id: '20250725030',
      personId: '3',
      date: '2025-07-25',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250725040',
      personId: '4',
      date: '2025-07-25',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250726010',
      personId: '1',
      date: '2025-07-26',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '20250726020',
      personId: '2',
      date: '2025-07-26',
      entries: [
        {
          eid: '__total__',
          val: 110,
        },
      ],
    },
    {
      id: '20250726030',
      personId: '3',
      date: '2025-07-26',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250726040',
      personId: '4',
      date: '2025-07-26',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250727010',
      personId: '1',
      date: '2025-07-27',
      entries: [
        {
          eid: '__total__',
          val: 160,
        },
      ],
    },
    {
      id: '20250727020',
      personId: '2',
      date: '2025-07-27',
      entries: [
        {
          eid: '__total__',
          val: 115.32,
        },
      ],
    },
    {
      id: '20250727030',
      personId: '3',
      date: '2025-07-27',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250727040',
      personId: '4',
      date: '2025-07-27',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250728010',
      personId: '1',
      date: '2025-07-28',
      entries: [
        {
          eid: '__total__',
          val: 163,
        },
      ],
    },
    {
      id: '20250728020',
      personId: '2',
      date: '2025-07-28',
      entries: [
        {
          eid: '__total__',
          val: 154,
        },
      ],
    },
    {
      id: '20250728030',
      personId: '3',
      date: '2025-07-28',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250728040',
      personId: '4',
      date: '2025-07-28',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250729010',
      personId: '1',
      date: '2025-07-29',
      entries: [
        {
          eid: '__total__',
          val: 173,
        },
      ],
    },
    {
      id: '20250729020',
      personId: '2',
      date: '2025-07-29',
      entries: [
        {
          eid: '__total__',
          val: 437.2,
        },
      ],
    },
    {
      id: '20250729030',
      personId: '3',
      date: '2025-07-29',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250729040',
      personId: '4',
      date: '2025-07-29',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250730010',
      personId: '1',
      date: '2025-07-30',
      entries: [
        {
          eid: '__total__',
          val: 261.5,
        },
      ],
    },
    {
      id: '20250730020',
      personId: '2',
      date: '2025-07-30',
      entries: [
        {
          eid: '__total__',
          val: 254,
        },
      ],
    },
    {
      id: '20250730030',
      personId: '3',
      date: '2025-07-30',
      entries: [
        {
          eid: '__total__',
          val: 420,
        },
      ],
    },
    {
      id: '20250730040',
      personId: '4',
      date: '2025-07-30',
      entries: [
        {
          eid: '__total__',
          val: 125,
        },
      ],
    },
    {
      id: '20250731010',
      personId: '1',
      date: '2025-07-31',
      entries: [
        {
          eid: '__total__',
          val: 340,
        },
      ],
    },
    {
      id: '20250731020',
      personId: '2',
      date: '2025-07-31',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '20250731030',
      personId: '3',
      date: '2025-07-31',
      entries: [
        {
          eid: '__total__',
          val: 420,
        },
      ],
    },
    {
      id: '20250731040',
      personId: '4',
      date: '2025-07-31',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250801010',
      personId: '1',
      date: '2025-08-01',
      entries: [
        {
          eid: '__total__',
          val: 160,
        },
      ],
    },
    {
      id: '20250801020',
      personId: '2',
      date: '2025-08-01',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250801030',
      personId: '3',
      date: '2025-08-01',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250801040',
      personId: '4',
      date: '2025-08-01',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250802010',
      personId: '1',
      date: '2025-08-02',
      entries: [
        {
          eid: '__total__',
          val: 147,
        },
      ],
    },
    {
      id: '20250802020',
      personId: '2',
      date: '2025-08-02',
      entries: [
        {
          eid: '__total__',
          val: 130,
        },
      ],
    },
    {
      id: '20250802030',
      personId: '3',
      date: '2025-08-02',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250802040',
      personId: '4',
      date: '2025-08-02',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250803010',
      personId: '1',
      date: '2025-08-03',
      entries: [
        {
          eid: '__total__',
          val: 110,
        },
      ],
    },
    {
      id: '20250803020',
      personId: '2',
      date: '2025-08-03',
      entries: [
        {
          eid: '__total__',
          val: 110,
        },
      ],
    },
    {
      id: '20250803030',
      personId: '3',
      date: '2025-08-03',
      entries: [
        {
          eid: '__total__',
          val: 551,
        },
      ],
    },
    {
      id: '20250803040',
      personId: '4',
      date: '2025-08-03',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250804010',
      personId: '1',
      date: '2025-08-04',
      entries: [
        {
          eid: '__total__',
          val: 277,
        },
      ],
    },
    {
      id: '20250804020',
      personId: '2',
      date: '2025-08-04',
      entries: [
        {
          eid: '__total__',
          val: 245,
        },
      ],
    },
    {
      id: '20250804030',
      personId: '3',
      date: '2025-08-04',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250804040',
      personId: '4',
      date: '2025-08-04',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250805010',
      personId: '1',
      date: '2025-08-05',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20250805030',
      personId: '3',
      date: '2025-08-05',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250805040',
      personId: '4',
      date: '2025-08-05',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '20250806010',
      personId: '1',
      date: '2025-08-06',
      entries: [
        {
          eid: '__total__',
          val: 320,
        },
      ],
    },
    {
      id: '20250806020',
      personId: '2',
      date: '2025-08-06',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250806030',
      personId: '3',
      date: '2025-08-06',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250806040',
      personId: '4',
      date: '2025-08-06',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250807010',
      personId: '1',
      date: '2025-08-07',
      entries: [
        {
          eid: '__total__',
          val: 220,
        },
      ],
    },
    {
      id: '20250807020',
      personId: '2',
      date: '2025-08-07',
      entries: [
        {
          eid: '__total__',
          val: 156.2,
        },
      ],
    },
    {
      id: '20250807030',
      personId: '3',
      date: '2025-08-07',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250807040',
      personId: '4',
      date: '2025-08-07',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '20250808010',
      personId: '1',
      date: '2025-08-08',
      entries: [
        {
          eid: '__total__',
          val: 175,
        },
      ],
    },
    {
      id: '20250808020',
      personId: '2',
      date: '2025-08-08',
      entries: [
        {
          eid: '__total__',
          val: 116,
        },
      ],
    },
    {
      id: '20250808030',
      personId: '3',
      date: '2025-08-08',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250808040',
      personId: '4',
      date: '2025-08-08',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '20250809010',
      personId: '1',
      date: '2025-08-09',
      entries: [
        {
          eid: '__total__',
          val: 155,
        },
      ],
    },
    {
      id: '20250809020',
      personId: '2',
      date: '2025-08-09',
      entries: [
        {
          eid: '__total__',
          val: 155,
        },
      ],
    },
    {
      id: '20250809030',
      personId: '3',
      date: '2025-08-09',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250809040',
      personId: '4',
      date: '2025-08-09',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250810010',
      personId: '1',
      date: '2025-08-10',
      entries: [
        {
          eid: '__total__',
          val: 110,
        },
      ],
    },
    {
      id: '20250810020',
      personId: '2',
      date: '2025-08-10',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '20250810030',
      personId: '3',
      date: '2025-08-10',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250810040',
      personId: '4',
      date: '2025-08-10',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250811010',
      personId: '1',
      date: '2025-08-11',
      entries: [
        {
          eid: '__total__',
          val: 265,
        },
      ],
    },
    {
      id: '20250811020',
      personId: '2',
      date: '2025-08-11',
      entries: [
        {
          eid: '__total__',
          val: 175.2,
        },
      ],
    },
    {
      id: '20250811030',
      personId: '3',
      date: '2025-08-11',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250811040',
      personId: '4',
      date: '2025-08-11',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250812010',
      personId: '1',
      date: '2025-08-12',
      entries: [
        {
          eid: '__total__',
          val: 222.5,
        },
      ],
    },
    {
      id: '20250812020',
      personId: '2',
      date: '2025-08-12',
      entries: [
        {
          eid: '__total__',
          val: 185.44,
        },
      ],
    },
    {
      id: '20250812030',
      personId: '3',
      date: '2025-08-12',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250812040',
      personId: '4',
      date: '2025-08-12',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250813010',
      personId: '1',
      date: '2025-08-13',
      entries: [
        {
          eid: '__total__',
          val: 195,
        },
      ],
    },
    {
      id: '20250813020',
      personId: '2',
      date: '2025-08-13',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20250813030',
      personId: '3',
      date: '2025-08-13',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250813040',
      personId: '4',
      date: '2025-08-13',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250814010',
      personId: '1',
      date: '2025-08-14',
      entries: [
        {
          eid: '__total__',
          val: 241,
        },
      ],
    },
    {
      id: '20250814020',
      personId: '2',
      date: '2025-08-14',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250814030',
      personId: '3',
      date: '2025-08-14',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250815010',
      personId: '1',
      date: '2025-08-15',
      entries: [
        {
          eid: '__total__',
          val: 311,
        },
      ],
    },
    {
      id: '20250815020',
      personId: '2',
      date: '2025-08-15',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '20250815030',
      personId: '3',
      date: '2025-08-15',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250816010',
      personId: '1',
      date: '2025-08-16',
      entries: [
        {
          eid: '__total__',
          val: 171,
        },
      ],
    },
    {
      id: '20250816020',
      personId: '2',
      date: '2025-08-16',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250816030',
      personId: '3',
      date: '2025-08-16',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250816040',
      personId: '4',
      date: '2025-08-16',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250817010',
      personId: '1',
      date: '2025-08-17',
      entries: [
        {
          eid: '__total__',
          val: 340,
        },
      ],
    },
    {
      id: '20250817020',
      personId: '2',
      date: '2025-08-17',
      entries: [
        {
          eid: '__total__',
          val: 330,
        },
      ],
    },
    {
      id: '20250817030',
      personId: '3',
      date: '2025-08-17',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250817040',
      personId: '4',
      date: '2025-08-17',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250818010',
      personId: '1',
      date: '2025-08-18',
      entries: [
        {
          eid: '__total__',
          val: 170,
        },
      ],
    },
    {
      id: '20250818020',
      personId: '2',
      date: '2025-08-18',
      entries: [
        {
          eid: '__total__',
          val: 255.44,
        },
      ],
    },
    {
      id: '20250818030',
      personId: '3',
      date: '2025-08-18',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250818040',
      personId: '4',
      date: '2025-08-18',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250819010',
      personId: '1',
      date: '2025-08-19',
      entries: [
        {
          eid: '__total__',
          val: 300,
        },
      ],
    },
    {
      id: '20250819020',
      personId: '2',
      date: '2025-08-19',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20250819030',
      personId: '3',
      date: '2025-08-19',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250819040',
      personId: '4',
      date: '2025-08-19',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250820010',
      personId: '1',
      date: '2025-08-20',
      entries: [
        {
          eid: '__total__',
          val: 280,
        },
      ],
    },
    {
      id: '20250820020',
      personId: '2',
      date: '2025-08-20',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '20250820030',
      personId: '3',
      date: '2025-08-20',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250820040',
      personId: '4',
      date: '2025-08-20',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250821010',
      personId: '1',
      date: '2025-08-21',
      entries: [
        {
          eid: '__total__',
          val: 263,
        },
      ],
    },
    {
      id: '20250821020',
      personId: '2',
      date: '2025-08-21',
      entries: [
        {
          eid: '__total__',
          val: 30,
        },
      ],
    },
    {
      id: '20250821030',
      personId: '3',
      date: '2025-08-21',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250821040',
      personId: '4',
      date: '2025-08-21',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250822010',
      personId: '1',
      date: '2025-08-22',
      entries: [
        {
          eid: '__total__',
          val: 170,
        },
      ],
    },
    {
      id: '20250822020',
      personId: '2',
      date: '2025-08-22',
      entries: [
        {
          eid: '__total__',
          val: 115,
        },
      ],
    },
    {
      id: '20250822030',
      personId: '3',
      date: '2025-08-22',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250822040',
      personId: '4',
      date: '2025-08-22',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250823010',
      personId: '1',
      date: '2025-08-23',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '20250823020',
      personId: '2',
      date: '2025-08-23',
      entries: [
        {
          eid: '__total__',
          val: 110,
        },
      ],
    },
    {
      id: '20250823030',
      personId: '3',
      date: '2025-08-23',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250823040',
      personId: '4',
      date: '2025-08-23',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250824010',
      personId: '1',
      date: '2025-08-24',
      entries: [
        {
          eid: '__total__',
          val: 170,
        },
      ],
    },
    {
      id: '20250824020',
      personId: '2',
      date: '2025-08-24',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250824030',
      personId: '3',
      date: '2025-08-24',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250824040',
      personId: '4',
      date: '2025-08-24',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250825010',
      personId: '1',
      date: '2025-08-25',
      entries: [
        {
          eid: '__total__',
          val: 145,
        },
      ],
    },
    {
      id: '20250825030',
      personId: '3',
      date: '2025-08-25',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250825040',
      personId: '4',
      date: '2025-08-25',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250826010',
      personId: '1',
      date: '2025-08-26',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '20250826020',
      personId: '2',
      date: '2025-08-26',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250826030',
      personId: '3',
      date: '2025-08-26',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250826040',
      personId: '4',
      date: '2025-08-26',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250827010',
      personId: '1',
      date: '2025-08-27',
      entries: [
        {
          eid: '__total__',
          val: 175,
        },
      ],
    },
    {
      id: '20250827020',
      personId: '2',
      date: '2025-08-27',
      entries: [
        {
          eid: '__total__',
          val: 141,
        },
      ],
    },
    {
      id: '20250827030',
      personId: '3',
      date: '2025-08-27',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250827040',
      personId: '4',
      date: '2025-08-27',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250828010',
      personId: '1',
      date: '2025-08-28',
      entries: [
        {
          eid: '__total__',
          val: 135,
        },
      ],
    },
    {
      id: '20250828020',
      personId: '2',
      date: '2025-08-28',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250828030',
      personId: '3',
      date: '2025-08-28',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250828040',
      personId: '4',
      date: '2025-08-28',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250829010',
      personId: '1',
      date: '2025-08-29',
      entries: [
        {
          eid: '__total__',
          val: 160,
        },
      ],
    },
    {
      id: '20250829030',
      personId: '3',
      date: '2025-08-29',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250829040',
      personId: '4',
      date: '2025-08-29',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250830010',
      personId: '1',
      date: '2025-08-30',
      entries: [
        {
          eid: '__total__',
          val: 125,
        },
      ],
    },
    {
      id: '20250830020',
      personId: '2',
      date: '2025-08-30',
      entries: [
        {
          eid: '__total__',
          val: 135,
        },
      ],
    },
    {
      id: '20250830030',
      personId: '3',
      date: '2025-08-30',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250830040',
      personId: '4',
      date: '2025-08-30',
      entries: [
        {
          eid: '__total__',
          val: 159.5,
        },
      ],
    },
    {
      id: '20250831010',
      personId: '1',
      date: '2025-08-31',
      entries: [
        {
          eid: '__total__',
          val: 130,
        },
      ],
    },
    {
      id: '20250831020',
      personId: '2',
      date: '2025-08-31',
      entries: [
        {
          eid: '__total__',
          val: 102,
        },
      ],
    },
    {
      id: '20250831030',
      personId: '3',
      date: '2025-08-31',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250831040',
      personId: '4',
      date: '2025-08-31',
      entries: [
        {
          eid: '__total__',
          val: 306,
        },
      ],
    },
    {
      id: '20250901010',
      personId: '1',
      date: '2025-09-01',
      entries: [
        {
          eid: '__total__',
          val: 160,
        },
      ],
    },
    {
      id: '20250901020',
      personId: '2',
      date: '2025-09-01',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250901030',
      personId: '3',
      date: '2025-09-01',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250901040',
      personId: '4',
      date: '2025-09-01',
      entries: [
        {
          eid: '__total__',
          val: 125,
        },
      ],
    },
    {
      id: '20250902010',
      personId: '1',
      date: '2025-09-02',
      entries: [
        {
          eid: '__total__',
          val: 299,
        },
      ],
    },
    {
      id: '20250902020',
      personId: '2',
      date: '2025-09-02',
      entries: [
        {
          eid: '__total__',
          val: 360,
        },
      ],
    },
    {
      id: '20250902030',
      personId: '3',
      date: '2025-09-02',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250902040',
      personId: '4',
      date: '2025-09-02',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250903010',
      personId: '1',
      date: '2025-09-03',
      entries: [
        {
          eid: '__total__',
          val: 170,
        },
      ],
    },
    {
      id: '20250903020',
      personId: '2',
      date: '2025-09-03',
      entries: [
        {
          eid: '__total__',
          val: 0.1,
        },
      ],
    },
    {
      id: '20250903030',
      personId: '3',
      date: '2025-09-03',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250903040',
      personId: '4',
      date: '2025-09-03',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250904010',
      personId: '1',
      date: '2025-09-04',
      entries: [
        {
          eid: '__total__',
          val: 240,
        },
      ],
    },
    {
      id: '20250904020',
      personId: '2',
      date: '2025-09-04',
      entries: [
        {
          eid: '__total__',
          val: 115,
        },
      ],
    },
    {
      id: '20250904030',
      personId: '3',
      date: '2025-09-04',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250904040',
      personId: '4',
      date: '2025-09-04',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250905010',
      personId: '1',
      date: '2025-09-05',
      entries: [
        {
          eid: '__total__',
          val: 170,
        },
      ],
    },
    {
      id: '20250905020',
      personId: '2',
      date: '2025-09-05',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250905030',
      personId: '3',
      date: '2025-09-05',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250905040',
      personId: '4',
      date: '2025-09-05',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250906010',
      personId: '1',
      date: '2025-09-06',
      entries: [
        {
          eid: '__total__',
          val: 130,
        },
      ],
    },
    {
      id: '20250906020',
      personId: '2',
      date: '2025-09-06',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250906030',
      personId: '3',
      date: '2025-09-06',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250906040',
      personId: '4',
      date: '2025-09-06',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250907010',
      personId: '1',
      date: '2025-09-07',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '20250907020',
      personId: '2',
      date: '2025-09-07',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250907030',
      personId: '3',
      date: '2025-09-07',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250907040',
      personId: '4',
      date: '2025-09-07',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250908010',
      personId: '1',
      date: '2025-09-08',
      entries: [
        {
          eid: '__total__',
          val: 170,
        },
      ],
    },
    {
      id: '20250908020',
      personId: '2',
      date: '2025-09-08',
      entries: [
        {
          eid: '__total__',
          val: 251.516,
        },
      ],
    },
    {
      id: '20250908030',
      personId: '3',
      date: '2025-09-08',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250909010',
      personId: '1',
      date: '2025-09-09',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20250909020',
      personId: '2',
      date: '2025-09-09',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250909030',
      personId: '3',
      date: '2025-09-09',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250910010',
      personId: '1',
      date: '2025-09-10',
      entries: [
        {
          eid: '__total__',
          val: 195,
        },
      ],
    },
    {
      id: '20250910020',
      personId: '2',
      date: '2025-09-10',
      entries: [
        {
          eid: '__total__',
          val: 0.1,
        },
      ],
    },
    {
      id: '20250910030',
      personId: '3',
      date: '2025-09-10',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250911010',
      personId: '1',
      date: '2025-09-11',
      entries: [
        {
          eid: '__total__',
          val: 226,
        },
      ],
    },
    {
      id: '20250911020',
      personId: '2',
      date: '2025-09-11',
      entries: [
        {
          eid: '__total__',
          val: 60,
        },
      ],
    },
    {
      id: '20250911030',
      personId: '3',
      date: '2025-09-11',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250912010',
      personId: '1',
      date: '2025-09-12',
      entries: [
        {
          eid: '__total__',
          val: 174,
        },
      ],
    },
    {
      id: '20250912020',
      personId: '2',
      date: '2025-09-12',
      entries: [
        {
          eid: '__total__',
          val: 0.1,
        },
      ],
    },
    {
      id: '20250912030',
      personId: '3',
      date: '2025-09-12',
      entries: [
        {
          eid: '__total__',
          val: 471,
        },
      ],
    },
    {
      id: '20250913010',
      personId: '1',
      date: '2025-09-13',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20250913020',
      personId: '2',
      date: '2025-09-13',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '20250913030',
      personId: '3',
      date: '2025-09-13',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250914010',
      personId: '1',
      date: '2025-09-14',
      entries: [
        {
          eid: '__total__',
          val: 266,
        },
      ],
    },
    {
      id: '20250914020',
      personId: '2',
      date: '2025-09-14',
      entries: [
        {
          eid: '__total__',
          val: 100.44,
        },
      ],
    },
    {
      id: '20250914030',
      personId: '3',
      date: '2025-09-14',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250915010',
      personId: '1',
      date: '2025-09-15',
      entries: [
        {
          eid: '__total__',
          val: 160,
        },
      ],
    },
    {
      id: '20250915020',
      personId: '2',
      date: '2025-09-15',
      entries: [
        {
          eid: '__total__',
          val: 300,
        },
      ],
    },
    {
      id: '20250915030',
      personId: '3',
      date: '2025-09-15',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250916010',
      personId: '1',
      date: '2025-09-16',
      entries: [
        {
          eid: '__total__',
          val: 130,
        },
      ],
    },
    {
      id: '20250916020',
      personId: '2',
      date: '2025-09-16',
      entries: [
        {
          eid: '__total__',
          val: 0.1,
        },
      ],
    },
    {
      id: '20250916030',
      personId: '3',
      date: '2025-09-16',
      entries: [
        {
          eid: '__total__',
          val: 351,
        },
      ],
    },
    {
      id: '20250917010',
      personId: '1',
      date: '2025-09-17',
      entries: [
        {
          eid: '__total__',
          val: 156,
        },
      ],
    },
    {
      id: '20250917020',
      personId: '2',
      date: '2025-09-17',
      entries: [
        {
          eid: '__total__',
          val: 250,
        },
      ],
    },
    {
      id: '20250917030',
      personId: '3',
      date: '2025-09-17',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250918010',
      personId: '1',
      date: '2025-09-18',
      entries: [
        {
          eid: '__total__',
          val: 280,
        },
      ],
    },
    {
      id: '20250918020',
      personId: '2',
      date: '2025-09-18',
      entries: [
        {
          eid: '__total__',
          val: 250,
        },
      ],
    },
    {
      id: '20250918030',
      personId: '3',
      date: '2025-09-18',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250919010',
      personId: '1',
      date: '2025-09-19',
      entries: [
        {
          eid: '__total__',
          val: 246,
        },
      ],
    },
    {
      id: '20250919020',
      personId: '2',
      date: '2025-09-19',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250919030',
      personId: '3',
      date: '2025-09-19',
      entries: [
        {
          eid: '__total__',
          val: 505,
        },
      ],
    },
    {
      id: '20250920010',
      personId: '1',
      date: '2025-09-20',
      entries: [
        {
          eid: '__total__',
          val: 10,
        },
      ],
    },
    {
      id: '20250920020',
      personId: '2',
      date: '2025-09-20',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20250920030',
      personId: '3',
      date: '2025-09-20',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250921020',
      personId: '2',
      date: '2025-09-21',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250921030',
      personId: '3',
      date: '2025-09-21',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250922010',
      personId: '1',
      date: '2025-09-22',
      entries: [
        {
          eid: '__total__',
          val: 140,
        },
      ],
    },
    {
      id: '20250922020',
      personId: '2',
      date: '2025-09-22',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '20250922030',
      personId: '3',
      date: '2025-09-22',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20250923010',
      personId: '1',
      date: '2025-09-23',
      entries: [
        {
          eid: '__total__',
          val: 156,
        },
      ],
    },
    {
      id: '20250923030',
      personId: '3',
      date: '2025-09-23',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250924010',
      personId: '1',
      date: '2025-09-24',
      entries: [
        {
          eid: '__total__',
          val: 106,
        },
      ],
    },
    {
      id: '20250924020',
      personId: '2',
      date: '2025-09-24',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250924030',
      personId: '3',
      date: '2025-09-24',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250925020',
      personId: '2',
      date: '2025-09-25',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250925030',
      personId: '3',
      date: '2025-09-25',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20250926010',
      personId: '1',
      date: '2025-09-26',
      entries: [
        {
          eid: '__total__',
          val: 227,
        },
      ],
    },
    {
      id: '20250926020',
      personId: '2',
      date: '2025-09-26',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20250926030',
      personId: '3',
      date: '2025-09-26',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250927030',
      personId: '3',
      date: '2025-09-27',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250928020',
      personId: '2',
      date: '2025-09-28',
      entries: [
        {
          eid: '__total__',
          val: 51,
        },
      ],
    },
    {
      id: '20250928030',
      personId: '3',
      date: '2025-09-28',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20250929030',
      personId: '3',
      date: '2025-09-29',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20250930020',
      personId: '2',
      date: '2025-09-30',
      entries: [
        {
          eid: '__total__',
          val: 180.24,
        },
      ],
    },
    {
      id: '20250930030',
      personId: '3',
      date: '2025-09-30',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20251001010',
      personId: '1',
      date: '2025-10-01',
      entries: [
        {
          eid: '__total__',
          val: 148,
        },
      ],
    },
    {
      id: '20251001030',
      personId: '3',
      date: '2025-10-01',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251002010',
      personId: '1',
      date: '2025-10-02',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251002020',
      personId: '2',
      date: '2025-10-02',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20251002030',
      personId: '3',
      date: '2025-10-02',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251003010',
      personId: '1',
      date: '2025-10-03',
      entries: [
        {
          eid: '__total__',
          val: 197,
        },
      ],
    },
    {
      id: '20251003020',
      personId: '2',
      date: '2025-10-03',
      entries: [
        {
          eid: '__total__',
          val: 205,
        },
      ],
    },
    {
      id: '20251003030',
      personId: '3',
      date: '2025-10-03',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20251004010',
      personId: '1',
      date: '2025-10-04',
      entries: [
        {
          eid: '__total__',
          val: 146,
        },
      ],
    },
    {
      id: '20251004020',
      personId: '2',
      date: '2025-10-04',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20251004030',
      personId: '3',
      date: '2025-10-04',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251005010',
      personId: '1',
      date: '2025-10-05',
      entries: [
        {
          eid: '__total__',
          val: 146,
        },
      ],
    },
    {
      id: '20251005030',
      personId: '3',
      date: '2025-10-05',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251006010',
      personId: '1',
      date: '2025-10-06',
      entries: [
        {
          eid: '__total__',
          val: 146,
        },
      ],
    },
    {
      id: '20251006020',
      personId: '2',
      date: '2025-10-06',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20251006030',
      personId: '3',
      date: '2025-10-06',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20251007010',
      personId: '1',
      date: '2025-10-07',
      entries: [
        {
          eid: '__total__',
          val: 146,
        },
      ],
    },
    {
      id: '20251007030',
      personId: '3',
      date: '2025-10-07',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20251008010',
      personId: '1',
      date: '2025-10-08',
      entries: [
        {
          eid: '__total__',
          val: 191,
        },
      ],
    },
    {
      id: '20251008030',
      personId: '3',
      date: '2025-10-08',
      entries: [
        {
          eid: '__total__',
          val: 151,
        },
      ],
    },
    {
      id: '20251009010',
      personId: '1',
      date: '2025-10-09',
      entries: [
        {
          eid: '__total__',
          val: 161,
        },
      ],
    },
    {
      id: '20251009030',
      personId: '3',
      date: '2025-10-09',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20251010010',
      personId: '1',
      date: '2025-10-10',
      entries: [
        {
          eid: '__total__',
          val: 115,
        },
      ],
    },
    {
      id: '20251010020',
      personId: '2',
      date: '2025-10-10',
      entries: [
        {
          eid: '__total__',
          val: 162,
        },
      ],
    },
    {
      id: '20251010030',
      personId: '3',
      date: '2025-10-10',
      entries: [
        {
          eid: '__total__',
          val: 251,
        },
      ],
    },
    {
      id: '20251011010',
      personId: '1',
      date: '2025-10-11',
      entries: [
        {
          eid: '__total__',
          val: 181,
        },
      ],
    },
    {
      id: '20251011030',
      personId: '3',
      date: '2025-10-11',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251012020',
      personId: '2',
      date: '2025-10-12',
      entries: [
        {
          eid: '__total__',
          val: 197.316,
        },
      ],
    },
    {
      id: '20251012030',
      personId: '3',
      date: '2025-10-12',
      entries: [
        {
          eid: '__total__',
          val: 301,
        },
      ],
    },
    {
      id: '20251013030',
      personId: '3',
      date: '2025-10-13',
      entries: [
        {
          eid: '__total__',
          val: 301,
        },
      ],
    },
    {
      id: '20251014010',
      personId: '1',
      date: '2025-10-14',
      entries: [
        {
          eid: '__total__',
          val: 181,
        },
      ],
    },
    {
      id: '20251014030',
      personId: '3',
      date: '2025-10-14',
      entries: [
        {
          eid: '__total__',
          val: 301,
        },
      ],
    },
    {
      id: '20251015010',
      personId: '1',
      date: '2025-10-15',
      entries: [
        {
          eid: '__total__',
          val: 166,
        },
      ],
    },
    {
      id: '20251015020',
      personId: '2',
      date: '2025-10-15',
      entries: [
        {
          eid: '__total__',
          val: 329.6,
        },
      ],
    },
    {
      id: '20251015030',
      personId: '3',
      date: '2025-10-15',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251016010',
      personId: '1',
      date: '2025-10-16',
      entries: [
        {
          eid: '__total__',
          val: 166,
        },
      ],
    },
    {
      id: '20251016020',
      personId: '2',
      date: '2025-10-16',
      entries: [
        {
          eid: '__total__',
          val: 136.08,
        },
      ],
    },
    {
      id: '20251016030',
      personId: '3',
      date: '2025-10-16',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251017010',
      personId: '1',
      date: '2025-10-17',
      entries: [
        {
          eid: '__total__',
          val: 135,
        },
      ],
    },
    {
      id: '20251017030',
      personId: '3',
      date: '2025-10-17',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251018030',
      personId: '3',
      date: '2025-10-18',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251019030',
      personId: '3',
      date: '2025-10-19',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251020010',
      personId: '1',
      date: '2025-10-20',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '20251020020',
      personId: '2',
      date: '2025-10-20',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20251020030',
      personId: '3',
      date: '2025-10-20',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251021010',
      personId: '1',
      date: '2025-10-21',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20251021020',
      personId: '2',
      date: '2025-10-21',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251021030',
      personId: '3',
      date: '2025-10-21',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251022010',
      personId: '1',
      date: '2025-10-22',
      entries: [
        {
          eid: '__total__',
          val: 200,
        },
      ],
    },
    {
      id: '20251022020',
      personId: '2',
      date: '2025-10-22',
      entries: [
        {
          eid: '__total__',
          val: 140,
        },
      ],
    },
    {
      id: '20251022030',
      personId: '3',
      date: '2025-10-22',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251023020',
      personId: '2',
      date: '2025-10-23',
      entries: [
        {
          eid: '__total__',
          val: 162,
        },
      ],
    },
    {
      id: '20251023030',
      personId: '3',
      date: '2025-10-23',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251024010',
      personId: '1',
      date: '2025-10-24',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251024020',
      personId: '2',
      date: '2025-10-24',
      entries: [
        {
          eid: '__total__',
          val: 140,
        },
      ],
    },
    {
      id: '20251024030',
      personId: '3',
      date: '2025-10-24',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251025010',
      personId: '1',
      date: '2025-10-25',
      entries: [
        {
          eid: '__total__',
          val: 106,
        },
      ],
    },
    {
      id: '20251025020',
      personId: '2',
      date: '2025-10-25',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251025030',
      personId: '3',
      date: '2025-10-25',
      entries: [
        {
          eid: '__total__',
          val: 121,
        },
      ],
    },
    {
      id: '20251026010',
      personId: '1',
      date: '2025-10-26',
      entries: [
        {
          eid: '__total__',
          val: 110,
        },
      ],
    },
    {
      id: '20251026020',
      personId: '2',
      date: '2025-10-26',
      entries: [
        {
          eid: '__total__',
          val: 205,
        },
      ],
    },
    {
      id: '20251027010',
      personId: '1',
      date: '2025-10-27',
      entries: [
        {
          eid: '__total__',
          val: 30,
        },
      ],
    },
    {
      id: '20251027020',
      personId: '2',
      date: '2025-10-27',
      entries: [
        {
          eid: '__total__',
          val: 30,
        },
      ],
    },
    {
      id: '20251028010',
      personId: '1',
      date: '2025-10-28',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20251028030',
      personId: '3',
      date: '2025-10-28',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251029010',
      personId: '1',
      date: '2025-10-29',
      entries: [
        {
          eid: '__total__',
          val: 66,
        },
      ],
    },
    {
      id: '20251029020',
      personId: '2',
      date: '2025-10-29',
      entries: [
        {
          eid: '__total__',
          val: 10,
        },
      ],
    },
    {
      id: '20251030020',
      personId: '2',
      date: '2025-10-30',
      entries: [
        {
          eid: '__total__',
          val: 32.4,
        },
      ],
    },
    {
      id: '20251101010',
      personId: '1',
      date: '2025-11-01',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20251101030',
      personId: '3',
      date: '2025-11-01',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251101060',
      personId: '6',
      date: '2025-11-01',
      entries: [
        {
          eid: '__total__',
          val: 103.705,
        },
      ],
    },
    {
      id: '20251102020',
      personId: '2',
      date: '2025-11-02',
      entries: [
        {
          eid: '__total__',
          val: 220,
        },
      ],
    },
    {
      id: '20251102030',
      personId: '3',
      date: '2025-11-02',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251102060',
      personId: '6',
      date: '2025-11-02',
      entries: [
        {
          eid: '__total__',
          val: 0.78,
        },
      ],
    },
    {
      id: '20251103020',
      personId: '2',
      date: '2025-11-03',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20251103060',
      personId: '6',
      date: '2025-11-03',
      entries: [
        {
          eid: '__total__',
          val: 13.775,
        },
      ],
    },
    {
      id: '20251104010',
      personId: '1',
      date: '2025-11-04',
      entries: [
        {
          eid: '__total__',
          val: 106,
        },
      ],
    },
    {
      id: '20251104030',
      personId: '3',
      date: '2025-11-04',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251104060',
      personId: '6',
      date: '2025-11-04',
      entries: [
        {
          eid: '__total__',
          val: 14.83,
        },
      ],
    },
    {
      id: '20251105010',
      personId: '1',
      date: '2025-11-05',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20251105020',
      personId: '2',
      date: '2025-11-05',
      entries: [
        {
          eid: '__total__',
          val: 279.716,
        },
      ],
    },
    {
      id: '20251105060',
      personId: '6',
      date: '2025-11-05',
      entries: [
        {
          eid: '__total__',
          val: 9.095,
        },
      ],
    },
    {
      id: '20251106010',
      personId: '1',
      date: '2025-11-06',
      entries: [
        {
          eid: '__total__',
          val: 90,
        },
      ],
    },
    {
      id: '20251106030',
      personId: '3',
      date: '2025-11-06',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251106060',
      personId: '6',
      date: '2025-11-06',
      entries: [
        {
          eid: '__total__',
          val: 13.71,
        },
      ],
    },
    {
      id: '20251107020',
      personId: '2',
      date: '2025-11-07',
      entries: [
        {
          eid: '__total__',
          val: 132,
        },
      ],
    },
    {
      id: '20251107030',
      personId: '3',
      date: '2025-11-07',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251107060',
      personId: '6',
      date: '2025-11-07',
      entries: [
        {
          eid: '__total__',
          val: 201.735,
        },
      ],
    },
    {
      id: '20251108010',
      personId: '1',
      date: '2025-11-08',
      entries: [
        {
          eid: '__total__',
          val: 80,
        },
      ],
    },
    {
      id: '20251108020',
      personId: '2',
      date: '2025-11-08',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20251108060',
      personId: '6',
      date: '2025-11-08',
      entries: [
        {
          eid: '__total__',
          val: 44.435,
        },
      ],
    },
    {
      id: '20251109060',
      personId: '6',
      date: '2025-11-09',
      entries: [
        {
          eid: '__total__',
          val: 12.01,
        },
      ],
    },
    {
      id: '20251110060',
      personId: '6',
      date: '2025-11-10',
      entries: [
        {
          eid: '__total__',
          val: 203.595,
        },
      ],
    },
    {
      id: '20251111010',
      personId: '1',
      date: '2025-11-11',
      entries: [
        {
          eid: '__total__',
          val: 160,
        },
      ],
    },
    {
      id: '20251111020',
      personId: '2',
      date: '2025-11-11',
      entries: [
        {
          eid: '__total__',
          val: 173.12,
        },
      ],
    },
    {
      id: '20251111060',
      personId: '6',
      date: '2025-11-11',
      entries: [
        {
          eid: '__total__',
          val: 174.21,
        },
      ],
    },
    {
      id: '20251112010',
      personId: '1',
      date: '2025-11-12',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251112020',
      personId: '2',
      date: '2025-11-12',
      entries: [
        {
          eid: '__total__',
          val: 156,
        },
      ],
    },
    {
      id: '20251112060',
      personId: '6',
      date: '2025-11-12',
      entries: [
        {
          eid: '__total__',
          val: 1.315,
        },
      ],
    },
    {
      id: '20251113060',
      personId: '6',
      date: '2025-11-13',
      entries: [
        {
          eid: '__total__',
          val: 16.445,
        },
      ],
    },
    {
      id: '20251114020',
      personId: '2',
      date: '2025-11-14',
      entries: [
        {
          eid: '__total__',
          val: 106,
        },
      ],
    },
    {
      id: '20251114030',
      personId: '3',
      date: '2025-11-14',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20251114060',
      personId: '6',
      date: '2025-11-14',
      entries: [
        {
          eid: '__total__',
          val: 10.985,
        },
      ],
    },
    {
      id: '20251115020',
      personId: '2',
      date: '2025-11-15',
      entries: [
        {
          eid: '__total__',
          val: 102,
        },
      ],
    },
    {
      id: '20251115060',
      personId: '6',
      date: '2025-11-15',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20251116060',
      personId: '6',
      date: '2025-11-16',
      entries: [
        {
          eid: '__total__',
          val: 3.38,
        },
      ],
    },
    {
      id: '20251117060',
      personId: '6',
      date: '2025-11-17',
      entries: [
        {
          eid: '__total__',
          val: 3.565,
        },
      ],
    },
    {
      id: '20251118010',
      personId: '1',
      date: '2025-11-18',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '20251118020',
      personId: '2',
      date: '2025-11-18',
      entries: [
        {
          eid: '__total__',
          val: 22,
        },
      ],
    },
    {
      id: '20251118030',
      personId: '3',
      date: '2025-11-18',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251118060',
      personId: '6',
      date: '2025-11-18',
      entries: [
        {
          eid: '__total__',
          val: 1.065,
        },
      ],
    },
    {
      id: '20251119010',
      personId: '1',
      date: '2025-11-19',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20251119060',
      personId: '6',
      date: '2025-11-19',
      entries: [
        {
          eid: '__total__',
          val: 3.405,
        },
      ],
    },
    {
      id: '20251120020',
      personId: '2',
      date: '2025-11-20',
      entries: [
        {
          eid: '__total__',
          val: 122,
        },
      ],
    },
    {
      id: '20251120030',
      personId: '3',
      date: '2025-11-20',
      entries: [
        {
          eid: '__total__',
          val: 301,
        },
      ],
    },
    {
      id: '20251120060',
      personId: '6',
      date: '2025-11-20',
      entries: [
        {
          eid: '__total__',
          val: 17.325,
        },
      ],
    },
    {
      id: '20251121020',
      personId: '2',
      date: '2025-11-21',
      entries: [
        {
          eid: '__total__',
          val: 203,
        },
      ],
    },
    {
      id: '20251121030',
      personId: '3',
      date: '2025-11-21',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251121060',
      personId: '6',
      date: '2025-11-21',
      entries: [
        {
          eid: '__total__',
          val: 15.57,
        },
      ],
    },
    {
      id: '20251122020',
      personId: '2',
      date: '2025-11-22',
      entries: [
        {
          eid: '__total__',
          val: 253.656,
        },
      ],
    },
    {
      id: '20251122030',
      personId: '3',
      date: '2025-11-22',
      entries: [
        {
          eid: '__total__',
          val: 231,
        },
      ],
    },
    {
      id: '20251122060',
      personId: '6',
      date: '2025-11-22',
      entries: [
        {
          eid: '__total__',
          val: 16.745,
        },
      ],
    },
    {
      id: '20251123020',
      personId: '2',
      date: '2025-11-23',
      entries: [
        {
          eid: '__total__',
          val: 221.94,
        },
      ],
    },
    {
      id: '20251123030',
      personId: '3',
      date: '2025-11-23',
      entries: [
        {
          eid: '__total__',
          val: 241,
        },
      ],
    },
    {
      id: '20251123060',
      personId: '6',
      date: '2025-11-23',
      entries: [
        {
          eid: '__total__',
          val: 70.165,
        },
      ],
    },
    {
      id: '20251124060',
      personId: '6',
      date: '2025-11-24',
      entries: [
        {
          eid: '__total__',
          val: 3.96,
        },
      ],
    },
    {
      id: '20251125060',
      personId: '6',
      date: '2025-11-25',
      entries: [
        {
          eid: '__total__',
          val: 192.61,
        },
      ],
    },
    {
      id: '20251126060',
      personId: '6',
      date: '2025-11-26',
      entries: [
        {
          eid: '__total__',
          val: 0.92,
        },
      ],
    },
    {
      id: '20251127030',
      personId: '3',
      date: '2025-11-27',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251127060',
      personId: '6',
      date: '2025-11-27',
      entries: [
        {
          eid: '__total__',
          val: 4.245,
        },
      ],
    },
    {
      id: '20251128020',
      personId: '2',
      date: '2025-11-28',
      entries: [
        {
          eid: '__total__',
          val: 213,
        },
      ],
    },
    {
      id: '20251128060',
      personId: '6',
      date: '2025-11-28',
      entries: [
        {
          eid: '__total__',
          val: 14.795,
        },
      ],
    },
    {
      id: '20251129020',
      personId: '2',
      date: '2025-11-29',
      entries: [
        {
          eid: '__total__',
          val: 110,
        },
      ],
    },
    {
      id: '20251129030',
      personId: '3',
      date: '2025-11-29',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20251129060',
      personId: '6',
      date: '2025-11-29',
      entries: [
        {
          eid: '__total__',
          val: 15.32,
        },
      ],
    },
    {
      id: '20251130020',
      personId: '2',
      date: '2025-11-30',
      entries: [
        {
          eid: '__total__',
          val: 130,
        },
      ],
    },
    {
      id: '20251130060',
      personId: '6',
      date: '2025-11-30',
      entries: [
        {
          eid: '__total__',
          val: 29.315,
        },
      ],
    },
    {
      id: '20251201010',
      personId: '1',
      date: '2025-12-01',
      entries: [
        {
          eid: '__total__',
          val: 115,
        },
      ],
    },
    {
      id: '20251201020',
      personId: '2',
      date: '2025-12-01',
      entries: [
        {
          eid: '__total__',
          val: 32,
        },
      ],
    },
    {
      id: '20251202010',
      personId: '1',
      date: '2025-12-02',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '20251202020',
      personId: '2',
      date: '2025-12-02',
      entries: [
        {
          eid: '__total__',
          val: 10,
        },
      ],
    },
    {
      id: '20251202030',
      personId: '3',
      date: '2025-12-02',
      entries: [
        {
          eid: '__total__',
          val: 321,
        },
      ],
    },
    {
      id: '20251203010',
      personId: '1',
      date: '2025-12-03',
      entries: [
        {
          eid: '__total__',
          val: 115,
        },
      ],
    },
    {
      id: '20251203020',
      personId: '2',
      date: '2025-12-03',
      entries: [
        {
          eid: '__total__',
          val: 123,
        },
      ],
    },
    {
      id: '20251203060',
      personId: '6',
      date: '2025-12-03',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '20251204010',
      personId: '1',
      date: '2025-12-04',
      entries: [
        {
          eid: '__total__',
          val: 50,
        },
      ],
    },
    {
      id: '20251204020',
      personId: '2',
      date: '2025-12-04',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251205010',
      personId: '1',
      date: '2025-12-05',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251206060',
      personId: '6',
      date: '2025-12-06',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20251207060',
      personId: '6',
      date: '2025-12-07',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20251208010',
      personId: '1',
      date: '2025-12-08',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251209010',
      personId: '1',
      date: '2025-12-09',
      entries: [
        {
          eid: '__total__',
          val: 210,
        },
      ],
    },
    {
      id: '20251209020',
      personId: '2',
      date: '2025-12-09',
      entries: [
        {
          eid: '__total__',
          val: 204,
        },
      ],
    },
    {
      id: '20251210010',
      personId: '1',
      date: '2025-12-10',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251210060',
      personId: '6',
      date: '2025-12-10',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '20251211010',
      personId: '1',
      date: '2025-12-11',
      entries: [
        {
          eid: '__total__',
          val: 50,
        },
      ],
    },
    {
      id: '20251211020',
      personId: '2',
      date: '2025-12-11',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251212010',
      personId: '1',
      date: '2025-12-12',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '20251212020',
      personId: '2',
      date: '2025-12-12',
      entries: [
        {
          eid: '__total__',
          val: 42,
        },
      ],
    },
    {
      id: '20251214020',
      personId: '2',
      date: '2025-12-14',
      entries: [
        {
          eid: '__total__',
          val: 102,
        },
      ],
    },
    {
      id: '20251216010',
      personId: '1',
      date: '2025-12-16',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20251216020',
      personId: '2',
      date: '2025-12-16',
      entries: [
        {
          eid: '__total__',
          val: 102,
        },
      ],
    },
    {
      id: '20251218010',
      personId: '1',
      date: '2025-12-18',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '20251223010',
      personId: '1',
      date: '2025-12-23',
      entries: [
        {
          eid: '__total__',
          val: 60,
        },
      ],
    },
    {
      id: '20251227010',
      personId: '1',
      date: '2025-12-27',
      entries: [
        {
          eid: '__total__',
          val: 20,
        },
      ],
    },
    {
      id: '20251227020',
      personId: '2',
      date: '2025-12-27',
      entries: [
        {
          eid: '__total__',
          val: 22,
        },
      ],
    },
    {
      id: '20260101010',
      personId: '1',
      date: '2026-01-01',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20260101020',
      personId: '2',
      date: '2026-01-01',
      entries: [
        {
          eid: '__total__',
          val: 106.8,
        },
      ],
    },
    {
      id: '20260101040',
      personId: '4',
      date: '2026-01-01',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20260101050',
      personId: '5',
      date: '2026-01-01',
      entries: [
        {
          eid: '__total__',
          val: 20,
        },
      ],
    },
    {
      id: '20260102040',
      personId: '4',
      date: '2026-01-02',
      entries: [
        {
          eid: '__total__',
          val: 60,
        },
      ],
    },
    {
      id: '20260103020',
      personId: '2',
      date: '2026-01-03',
      entries: [
        {
          eid: '__total__',
          val: 106.8,
        },
      ],
    },
    {
      id: '20260103040',
      personId: '4',
      date: '2026-01-03',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20260103050',
      personId: '5',
      date: '2026-01-03',
      entries: [
        {
          eid: '__total__',
          val: 15,
        },
      ],
    },
    {
      id: '20260104050',
      personId: '5',
      date: '2026-01-04',
      entries: [
        {
          eid: '__total__',
          val: 30,
        },
      ],
    },
    {
      id: '20260106030',
      personId: '3',
      date: '2026-01-06',
      entries: [
        {
          eid: '__total__',
          val: 161,
        },
      ],
    },
    {
      id: '20260106050',
      personId: '5',
      date: '2026-01-06',
      entries: [
        {
          eid: '__total__',
          val: 75,
        },
      ],
    },
    {
      id: '20260106060',
      personId: '6',
      date: '2026-01-06',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20260107030',
      personId: '3',
      date: '2026-01-07',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20260107050',
      personId: '5',
      date: '2026-01-07',
      entries: [
        {
          eid: '__total__',
          val: 20,
        },
      ],
    },
    {
      id: '20260107060',
      personId: '6',
      date: '2026-01-07',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20260108030',
      personId: '3',
      date: '2026-01-08',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20260109030',
      personId: '3',
      date: '2026-01-09',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20260109050',
      personId: '5',
      date: '2026-01-09',
      entries: [
        {
          eid: '__total__',
          val: 45,
        },
      ],
    },
    {
      id: '20260109060',
      personId: '6',
      date: '2026-01-09',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20260110060',
      personId: '6',
      date: '2026-01-10',
      entries: [
        {
          eid: '__total__',
          val: 160,
        },
      ],
    },
    {
      id: '20260112030',
      personId: '3',
      date: '2026-01-12',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20260113030',
      personId: '3',
      date: '2026-01-13',
      entries: [
        {
          eid: '__total__',
          val: 121,
        },
      ],
    },
    {
      id: '20260113050',
      personId: '5',
      date: '2026-01-13',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20260114060',
      personId: '6',
      date: '2026-01-14',
      entries: [
        {
          eid: '__total__',
          val: 190,
        },
      ],
    },
    {
      id: '20260115050',
      personId: '5',
      date: '2026-01-15',
      entries: [
        {
          eid: '__total__',
          val: 45,
        },
      ],
    },
    {
      id: '20260115060',
      personId: '6',
      date: '2026-01-15',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '20260118060',
      personId: '6',
      date: '2026-01-18',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '20260120050',
      personId: '5',
      date: '2026-01-20',
      entries: [
        {
          eid: '__total__',
          val: 85,
        },
      ],
    },
    {
      id: '20260120060',
      personId: '6',
      date: '2026-01-20',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20260121020',
      personId: '2',
      date: '2026-01-21',
      entries: [
        {
          eid: '__total__',
          val: 16.8,
        },
      ],
    },
    {
      id: '20260122050',
      personId: '5',
      date: '2026-01-22',
      entries: [
        {
          eid: '__total__',
          val: 15,
        },
      ],
    },
    {
      id: '20260123050',
      personId: '5',
      date: '2026-01-23',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '20260124050',
      personId: '5',
      date: '2026-01-24',
      entries: [
        {
          eid: '__total__',
          val: 15,
        },
      ],
    },
    {
      id: '20260125050',
      personId: '5',
      date: '2026-01-25',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '20260126050',
      personId: '5',
      date: '2026-01-26',
      entries: [
        {
          eid: '__total__',
          val: 20,
        },
      ],
    },
    {
      id: '20260127050',
      personId: '5',
      date: '2026-01-27',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '20260128050',
      personId: '5',
      date: '2026-01-28',
      entries: [
        {
          eid: '__total__',
          val: 60,
        },
      ],
    },
    {
      id: '20260128060',
      personId: '6',
      date: '2026-01-28',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '20260128070',
      personId: '7',
      date: '2026-01-28',
      entries: [
        {
          eid: '__total__',
          val: 240,
        },
      ],
    },
    {
      id: '20260129070',
      personId: '7',
      date: '2026-01-29',
      entries: [
        {
          eid: '__total__',
          val: 240,
        },
      ],
    },
    {
      id: '20260130050',
      personId: '5',
      date: '2026-01-30',
      entries: [
        {
          eid: '__total__',
          val: 45,
        },
      ],
    },
    {
      id: '20260130070',
      personId: '7',
      date: '2026-01-30',
      entries: [
        {
          eid: '__total__',
          val: 300,
        },
      ],
    },
    {
      id: '20260131050',
      personId: '5',
      date: '2026-01-31',
      entries: [
        {
          eid: '__total__',
          val: 30,
        },
      ],
    },
    {
      id: '20260201020',
      personId: '2',
      date: '2026-02-01',
      entries: [
        {
          eid: '__total__',
          val: 11.2,
        },
      ],
    },
    {
      id: '20260201040',
      personId: '4',
      date: '2026-02-01',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20260201050',
      personId: '5',
      date: '2026-02-01',
      entries: [
        {
          eid: '__total__',
          val: 60,
        },
      ],
    },
    {
      id: '20260202020',
      personId: '2',
      date: '2026-02-02',
      entries: [
        {
          eid: '__total__',
          val: 53.4,
        },
      ],
    },
    {
      id: '20260202040',
      personId: '4',
      date: '2026-02-02',
      entries: [
        {
          eid: '__total__',
          val: 60,
        },
      ],
    },
    {
      id: '20260203040',
      personId: '4',
      date: '2026-02-03',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20260203050',
      personId: '5',
      date: '2026-02-03',
      entries: [
        {
          eid: '__total__',
          val: 90,
        },
      ],
    },
    {
      id: '20260205050',
      personId: '5',
      date: '2026-02-05',
      entries: [
        {
          eid: '__total__',
          val: 50,
        },
      ],
    },
    {
      id: '20260207030',
      personId: '3',
      date: '2026-02-07',
      entries: [
        {
          eid: '__total__',
          val: 161,
        },
      ],
    },
    {
      id: '20260208030',
      personId: '3',
      date: '2026-02-08',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20260209030',
      personId: '3',
      date: '2026-02-09',
      entries: [
        {
          eid: '__total__',
          val: 100,
        },
      ],
    },
    {
      id: '20260210030',
      personId: '3',
      date: '2026-02-10',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '20260210050',
      personId: '5',
      date: '2026-02-10',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '20260212050',
      personId: '5',
      date: '2026-02-12',
      entries: [
        {
          eid: '__total__',
          val: 50,
        },
      ],
    },
    {
      id: '20260213030',
      personId: '3',
      date: '2026-02-13',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '20260214030',
      personId: '3',
      date: '2026-02-14',
      entries: [
        {
          eid: '__total__',
          val: 121,
        },
      ],
    },
    {
      id: '20260224050',
      personId: '5',
      date: '2026-02-24',
      entries: [
        {
          eid: '__total__',
          val: 55,
        },
      ],
    },
    {
      id: '20260226050',
      personId: '5',
      date: '2026-02-26',
      entries: [
        {
          eid: '__total__',
          val: 60,
        },
      ],
    },
    {
      id: '2001',
      personId: '5',
      date: '2026-03-02',
      entries: [
        {
          eid: '1',
          val: 30,
        },
      ],
    },
    {
      id: '2002',
      personId: '5',
      date: '2026-03-04',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '2003',
      personId: '5',
      date: '2026-03-07',
      entries: [
        {
          eid: '1',
          val: 30,
        },
      ],
    },
    {
      id: '2000',
      personId: '3',
      date: '2026-03-09',
      entries: [
        {
          eid: '__total__',
          val: 131,
        },
      ],
    },
    {
      id: '2004',
      personId: '5',
      date: '2026-03-10',
      entries: [
        {
          eid: '__total__',
          val: 126,
        },
      ],
    },
    {
      id: '2005',
      personId: '5',
      date: '2026-03-12',
      entries: [
        {
          eid: '1',
          val: 60,
        },
      ],
    },
    {
      id: '2006',
      personId: '5',
      date: '2026-03-17',
      entries: [
        {
          eid: '1',
          val: 60,
        },
      ],
    },
    {
      id: '2007',
      personId: '5',
      date: '2026-03-19',
      entries: [
        {
          eid: '1',
          val: 90,
        },
      ],
    },
    {
      id: '2008',
      personId: '5',
      date: '2026-03-22',
      entries: [
        {
          eid: '1',
          val: 80,
        },
      ],
    },
    {
      id: '2009',
      personId: '5',
      date: '2026-03-24',
      entries: [
        {
          eid: '1',
          val: 40,
        },
      ],
    },
    {
      id: '2010',
      personId: '5',
      date: '2026-03-26',
      entries: [
        {
          eid: '1',
          val: 60,
        },
      ],
    },
    {
      id: '2011',
      personId: '5',
      date: '2026-03-27',
      entries: [
        {
          eid: '1',
          val: 80,
        },
      ],
    },
    {
      id: '2054',
      personId: '7',
      date: '2026-04-01',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '2012',
      personId: '1',
      date: '2026-04-02',
      entries: [
        {
          eid: '1',
          val: 60,
        },
        {
          eid: '2',
          val: 20,
        },
        {
          eid: '5',
          val: 25,
        },
      ],
    },
    {
      id: '2027',
      personId: '3',
      date: '2026-04-02',
      entries: [
        {
          eid: '__total__',
          val: 198,
        },
      ],
    },
    {
      id: '2055',
      personId: '7',
      date: '2026-04-02',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '2013',
      personId: '1',
      date: '2026-04-03',
      entries: [
        {
          eid: '1',
          val: 25,
        },
        {
          eid: '2',
          val: 10,
        },
        {
          eid: '5',
          val: 10,
        },
        {
          eid: '8',
          val: 2.25,
        },
      ],
    },
    {
      id: '2028',
      personId: '3',
      date: '2026-04-03',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '2040',
      personId: '5',
      date: '2026-04-03',
      entries: [
        {
          eid: '1',
          val: 90,
        },
      ],
    },
    {
      id: '2051',
      personId: '6',
      date: '2026-04-04',
      entries: [
        {
          eid: '__total__',
          val: 180,
        },
      ],
    },
    {
      id: '2056',
      personId: '7',
      date: '2026-04-04',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '2018',
      personId: '2',
      date: '2026-04-05',
      entries: [
        {
          eid: '__total__',
          val: 171.72,
        },
      ],
    },
    {
      id: '2041',
      personId: '5',
      date: '2026-04-05',
      entries: [
        {
          eid: '1',
          val: 20,
        },
      ],
    },
    {
      id: '2057',
      personId: '7',
      date: '2026-04-05',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '2014',
      personId: '1',
      date: '2026-04-06',
      entries: [
        {
          eid: '1',
          val: 65,
        },
        {
          eid: '5',
          val: 20,
        },
      ],
    },
    {
      id: '2019',
      personId: '2',
      date: '2026-04-06',
      entries: [
        {
          eid: '__total__',
          val: 42.16,
        },
      ],
    },
    {
      id: '2042',
      personId: '5',
      date: '2026-04-06',
      entries: [
        {
          eid: '4',
          val: 7,
        },
      ],
    },
    {
      id: '2058',
      personId: '7',
      date: '2026-04-06',
      entries: [
        {
          eid: '__total__',
          val: 150,
        },
      ],
    },
    {
      id: '2043',
      personId: '5',
      date: '2026-04-07',
      entries: [
        {
          eid: '1',
          val: 60,
        },
      ],
    },
    {
      id: '2052',
      personId: '6',
      date: '2026-04-07',
      entries: [
        {
          eid: '__total__',
          val: 145,
        },
      ],
    },
    {
      id: '2059',
      personId: '7',
      date: '2026-04-07',
      entries: [
        {
          eid: '__total__',
          val: 90,
        },
      ],
    },
    {
      id: '2053',
      personId: '6',
      date: '2026-04-08',
      entries: [
        {
          eid: '__total__',
          val: 120,
        },
      ],
    },
    {
      id: '2060',
      personId: '7',
      date: '2026-04-08',
      entries: [
        {
          eid: '__total__',
          val: 91,
        },
      ],
    },
    {
      id: '2015',
      personId: '1',
      date: '2026-04-09',
      entries: [
        {
          eid: '8',
          val: 2.25,
        },
      ],
    },
    {
      id: '2044',
      personId: '5',
      date: '2026-04-09',
      entries: [
        {
          eid: '1',
          val: 90,
        },
      ],
    },
    {
      id: '2020',
      personId: '2',
      date: '2026-04-10',
      entries: [
        {
          eid: '__total__',
          val: 100.44,
        },
      ],
    },
    {
      id: '2029',
      personId: '3',
      date: '2026-04-10',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '2061',
      personId: '7',
      date: '2026-04-10',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '2030',
      personId: '3',
      date: '2026-04-11',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '2062',
      personId: '7',
      date: '2026-04-11',
      entries: [
        {
          eid: '__total__',
          val: 82.5,
        },
      ],
    },
    {
      id: '2031',
      personId: '3',
      date: '2026-04-12',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '2063',
      personId: '7',
      date: '2026-04-12',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '2064',
      personId: '7',
      date: '2026-04-13',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '2032',
      personId: '3',
      date: '2026-04-14',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '2045',
      personId: '5',
      date: '2026-04-14',
      entries: [
        {
          eid: '__total__',
          val: 55,
        },
      ],
    },
    {
      id: '2065',
      personId: '7',
      date: '2026-04-14',
      entries: [
        {
          eid: '__total__',
          val: 105,
        },
      ],
    },
    {
      id: '2033',
      personId: '3',
      date: '2026-04-15',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '2034',
      personId: '3',
      date: '2026-04-16',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '2066',
      personId: '7',
      date: '2026-04-16',
      entries: [
        {
          eid: '__total__',
          val: 82.5,
        },
      ],
    },
    {
      id: '2016',
      personId: '1',
      date: '2026-04-17',
      entries: [
        {
          eid: '1',
          val: 20,
        },
        {
          eid: '8',
          val: 2.4,
        },
      ],
    },
    {
      id: '2035',
      personId: '3',
      date: '2026-04-17',
      entries: [
        {
          eid: '__total__',
          val: 281,
        },
      ],
    },
    {
      id: '2046',
      personId: '5',
      date: '2026-04-17',
      entries: [
        {
          eid: '1',
          val: 40,
        },
      ],
    },
    {
      id: '2067',
      personId: '7',
      date: '2026-04-17',
      entries: [
        {
          eid: '__total__',
          val: 82.5,
        },
      ],
    },
    {
      id: '2068',
      personId: '7',
      date: '2026-04-18',
      entries: [
        {
          eid: '__total__',
          val: 82.5,
        },
      ],
    },
    {
      id: '2047',
      personId: '5',
      date: '2026-04-19',
      entries: [
        {
          eid: '__total__',
          val: 10,
        },
      ],
    },
    {
      id: '2069',
      personId: '7',
      date: '2026-04-19',
      entries: [
        {
          eid: '__total__',
          val: 22.5,
        },
      ],
    },
    {
      id: '2048',
      personId: '5',
      date: '2026-04-20',
      entries: [
        {
          eid: '__total__',
          val: 15,
        },
      ],
    },
    {
      id: '2070',
      personId: '7',
      date: '2026-04-20',
      entries: [
        {
          eid: '__total__',
          val: 22.5,
        },
      ],
    },
    {
      id: '2017',
      personId: '1',
      date: '2026-04-21',
      entries: [
        {
          eid: '8',
          val: 2.25,
        },
      ],
    },
    {
      id: '2021',
      personId: '2',
      date: '2026-04-21',
      entries: [
        {
          eid: '__total__',
          val: 100.44,
        },
      ],
    },
    {
      id: '2036',
      personId: '3',
      date: '2026-04-21',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '2049',
      personId: '5',
      date: '2026-04-21',
      entries: [
        {
          eid: '__total__',
          val: 40,
        },
      ],
    },
    {
      id: '2037',
      personId: '3',
      date: '2026-04-22',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '2050',
      personId: '5',
      date: '2026-04-22',
      entries: [
        {
          eid: '1',
          val: 15,
        },
      ],
    },
    {
      id: '2071',
      personId: '7',
      date: '2026-04-22',
      entries: [
        {
          eid: '__total__',
          val: 102.5,
        },
      ],
    },
    {
      id: '2022',
      personId: '2',
      date: '2026-04-23',
      entries: [
        {
          eid: '2',
          val: 30,
        },
      ],
    },
    {
      id: '2038',
      personId: '3',
      date: '2026-04-23',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '2072',
      personId: '7',
      date: '2026-04-23',
      entries: [
        {
          eid: '__total__',
          val: 102.5,
        },
      ],
    },
    {
      id: '2073',
      personId: '7',
      date: '2026-04-24',
      entries: [
        {
          eid: '__total__',
          val: 102.5,
        },
      ],
    },
    {
      id: '2074',
      personId: '7',
      date: '2026-04-25',
      entries: [
        {
          eid: '__total__',
          val: 54.5,
        },
      ],
    },
    {
      id: '2039',
      personId: '3',
      date: '2026-04-26',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '2075',
      personId: '7',
      date: '2026-04-26',
      entries: [
        {
          eid: '__total__',
          val: 22.5,
        },
      ],
    },
    {
      id: '2023',
      personId: '2',
      date: '2026-04-27',
      entries: [
        {
          eid: '__total__',
          val: 118.16,
        },
      ],
    },
    {
      id: '2076',
      personId: '7',
      date: '2026-04-27',
      entries: [
        {
          eid: '__total__',
          val: 140,
        },
      ],
    },
    {
      id: '2024',
      personId: '2',
      date: '2026-04-28',
      entries: [
        {
          eid: '__total__',
          val: 116.44,
        },
      ],
    },
    {
      id: '2025',
      personId: '2',
      date: '2026-04-29',
      entries: [
        {
          eid: '__total__',
          val: 25.6,
        },
      ],
    },
    {
      id: '2026',
      personId: '2',
      date: '2026-04-30',
      entries: [
        {
          eid: '__total__',
          val: 26.4,
        },
      ],
    },
    {
      id: '2077',
      personId: '2',
      date: '2026-05-02',
      entries: [
        {
          eid: '__total__',
          val: 24,
        },
      ],
    },
    {
      id: '2078',
      personId: '2',
      date: '2026-05-03',
      entries: [
        {
          eid: '__total__',
          val: 24,
        },
      ],
    },
    {
      id: '2079',
      personId: '2',
      date: '2026-05-04',
      entries: [
        {
          eid: '__total__',
          val: 28,
        },
      ],
    },
    {
      id: '2100',
      personId: '3',
      date: '2026-05-04',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '2080',
      personId: '2',
      date: '2026-05-05',
      entries: [
        {
          eid: '__total__',
          val: 24,
        },
      ],
    },
    {
      id: '2081',
      personId: '2',
      date: '2026-05-06',
      entries: [
        {
          eid: '__total__',
          val: 20,
        },
      ],
    },
    {
      id: '2082',
      personId: '2',
      date: '2026-05-07',
      entries: [
        {
          eid: '__total__',
          val: 32,
        },
      ],
    },
    {
      id: '2083',
      personId: '2',
      date: '2026-05-08',
      entries: [
        {
          eid: '__total__',
          val: 8,
        },
      ],
    },
    {
      id: '2084',
      personId: '2',
      date: '2026-05-09',
      entries: [
        {
          eid: '__total__',
          val: 228.88,
        },
      ],
    },
    {
      id: '2085',
      personId: '2',
      date: '2026-05-10',
      entries: [
        {
          eid: '__total__',
          val: 24,
        },
      ],
    },
    {
      id: '2086',
      personId: '2',
      date: '2026-05-11',
      entries: [
        {
          eid: '__total__',
          val: 28,
        },
      ],
    },
    {
      id: '2087',
      personId: '2',
      date: '2026-05-13',
      entries: [
        {
          eid: '__total__',
          val: 38,
        },
      ],
    },
    {
      id: '2088',
      personId: '2',
      date: '2026-05-14',
      entries: [
        {
          eid: '__total__',
          val: 106.8,
        },
      ],
    },
    {
      id: '2089',
      personId: '2',
      date: '2026-05-15',
      entries: [
        {
          eid: '__total__',
          val: 24,
        },
      ],
    },
    {
      id: '2101',
      personId: '3',
      date: '2026-05-15',
      entries: [
        {
          eid: '__total__',
          val: 101,
        },
      ],
    },
    {
      id: '2090',
      personId: '2',
      date: '2026-05-16',
      entries: [
        {
          eid: '__total__',
          val: 224.88,
        },
      ],
    },
    {
      id: '2102',
      personId: '3',
      date: '2026-05-16',
      entries: [
        {
          eid: '__total__',
          val: 240,
        },
      ],
    },
    {
      id: '2091',
      personId: '2',
      date: '2026-05-17',
      entries: [
        {
          eid: '__total__',
          val: 16,
        },
      ],
    },
    {
      id: '2103',
      personId: '3',
      date: '2026-05-17',
      entries: [
        {
          eid: '__total__',
          val: 201,
        },
      ],
    },
    {
      id: '2092',
      personId: '2',
      date: '2026-05-18',
      entries: [
        {
          eid: '__total__',
          val: 157.8,
        },
      ],
    },
    {
      id: '2104',
      personId: '3',
      date: '2026-05-18',
      entries: [
        {
          eid: '__total__',
          val: 1,
        },
      ],
    },
    {
      id: '2093',
      personId: '2',
      date: '2026-05-19',
      entries: [
        {
          eid: '__total__',
          val: 20,
        },
      ],
    },
    {
      id: '2094',
      personId: '2',
      date: '2026-05-20',
      entries: [
        {
          eid: '__total__',
          val: 44,
        },
      ],
    },
    {
      id: '2095',
      personId: '2',
      date: '2026-05-22',
      entries: [
        {
          eid: '__total__',
          val: 100.44,
        },
      ],
    },
    {
      id: '2105',
      personId: '3',
      date: '2026-05-22',
      entries: [
        {
          eid: '4',
          val: 5,
        },
      ],
    },
    {
      id: '2096',
      personId: '2',
      date: '2026-05-23',
      entries: [
        {
          eid: '__total__',
          val: 28,
        },
      ],
    },
    {
      id: '2097',
      personId: '2',
      date: '2026-05-24',
      entries: [
        {
          eid: '__total__',
          val: 20,
        },
      ],
    },
    {
      id: '2098',
      personId: '2',
      date: '2026-05-25',
      entries: [
        {
          eid: '__total__',
          val: 32,
        },
      ],
    },
    {
      id: '2099',
      personId: '2',
      date: '2026-05-26',
      entries: [
        {
          eid: '__total__',
          val: 36,
        },
      ],
    },
    {
      id: '2106',
      personId: '3',
      date: '2026-05-26',
      entries: [
        {
          eid: '4',
          val: 10,
        },
      ],
    },
    {
      id: '2107',
      personId: '3',
      date: '2026-05-27',
      entries: [
        {
          eid: '4',
          val: 5,
        },
      ],
    },
    {
      id: '2108',
      personId: '3',
      date: '2026-05-28',
      entries: [
        {
          eid: '4',
          val: 5,
        },
      ],
    },
    {
      id: '2109',
      personId: '3',
      date: '2026-05-29',
      entries: [
        {
          eid: '4',
          val: 5,
        },
      ],
    },
  ],
  movies: [
    {
      id: 'm0',
      title: 'Hobbit: Desolation of Smaug',
      rt: '74%',
      ratings: {
        '1': {
          score: 99,
        },
      },
    },
    {
      id: 'm1',
      title: 'LOTR: Fellowship of the Ring',
      rt: '91%',
      ratings: {
        '1': {
          score: 99,
        },
        '3': {
          score: 99,
        },
        '5': {
          score: 99,
        },
        '6': {
          score: 99,
        },
      },
    },
    {
      id: 'm2',
      title: 'The Lord of the Rings: The Return of the King',
      rt: '94%',
      ratings: {
        '1': {
          score: 98,
        },
        '3': {
          score: 99,
        },
        '5': {
          score: 100,
        },
        '6': {
          score: 99,
        },
      },
    },
    {
      id: 'm3',
      title: 'The Lord of the Rings: The Two Towers',
      rt: '95%',
      ratings: {
        '1': {
          score: 98,
        },
        '3': {
          score: 99,
        },
        '5': {
          score: 99,
        },
        '6': {
          score: 99,
        },
      },
    },
    {
      id: 'm4',
      title: 'Pulp Fiction',
      rt: '92%',
      ratings: {
        '1': {
          score: 98,
        },
        '3': {
          score: 99,
        },
        '5': {
          score: 98,
        },
      },
    },
    {
      id: 'm5',
      title: 'Tropic Thunder',
      rt: '82%',
      ratings: {
        '1': {
          score: 96,
        },
        '3': {
          score: 98,
        },
        '5': {
          score: 98,
        },
      },
    },
    {
      id: 'm6',
      title: 'The Dark Knight',
      rt: '94%',
      ratings: {
        '1': {
          score: 96,
        },
        '2': {
          score: 95,
        },
        '3': {
          score: 99,
        },
        '5': {
          score: 99,
        },
      },
    },
    {
      id: 'm7',
      title: 'Parasite',
      rt: '99%',
      ratings: {
        '1': {
          score: 94,
        },
        '2': {
          score: 94,
        },
        '3': {
          score: 99,
        },
        '6': {
          score: 95,
        },
      },
    },
    {
      id: 'm8',
      title: 'The Incredibles',
      ratings: {
        '1': {
          score: 98,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 98,
        },
      },
    },
    {
      id: 'm9',
      title: 'Avatar: The Way of Water',
      rt: '76%',
      ratings: {
        '1': {
          score: 93,
        },
        '2': {
          score: 90,
        },
        '3': {
          score: 99,
        },
        '5': {
          score: 99,
        },
      },
    },
    {
      id: 'm10',
      title: 'H8ful8',
      rt: '74%',
      ratings: {
        '1': {
          score: 92,
        },
        '3': {
          score: 98,
        },
        '5': {
          score: 95,
        },
        '6': {
          score: 95,
        },
      },
    },
    {
      id: 'm11',
      title: 'The Dark Knight: Rises',
      rt: '90%',
      ratings: {
        '1': {
          score: 90,
        },
        '3': {
          score: 95,
        },
        '5': {
          score: 98,
        },
      },
    },
    {
      id: 'm12',
      title: 'Mad Max: Fury Road',
      rt: '97%',
      ratings: {
        '1': {
          score: 96,
        },
        '2': {
          score: 89,
        },
        '3': {
          score: 98,
        },
        '5': {
          score: 98,
        },
        '6': {
          score: 90,
        },
      },
    },
    {
      id: 'm13',
      title: 'Mad Max Furiosa',
      rt: '90%',
      ratings: {
        '1': {
          score: 95,
        },
        '2': {
          score: 93,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 98,
        },
      },
    },
    {
      id: 'm14',
      title: 'Edge of Tomorrow',
      rt: '91%',
      ratings: {
        '1': {
          score: 94,
        },
        '3': {
          score: 91,
        },
        '5': {
          score: 97,
        },
      },
    },
    {
      id: 'm15',
      title: 'Barbarian',
      rt: '92%',
      ratings: {
        '1': {
          score: 87,
        },
        '2': {
          score: 93,
        },
        '3': {
          score: 99,
        },
      },
    },
    {
      id: 'm16',
      title: 'Nope',
      rt: '83%',
      ratings: {
        '1': {
          score: 93,
        },
        '2': {
          score: 94,
        },
        '3': {
          score: 92,
        },
        '5': {
          score: 91,
        },
      },
    },
    {
      id: 'm17',
      title: 'Dungeons and Dragons: Honor Among Theives',
      rt: '91%',
      ratings: {
        '1': {
          score: 97,
        },
        '3': {
          score: 88,
        },
        '5': {
          score: 99,
        },
        '6': {
          score: 85,
        },
      },
    },
    {
      id: 'm18',
      title: 'Avatar: Fire and Ash',
      ratings: {
        '1': {
          score: 92,
        },
        '2': {
          score: 85,
        },
        '3': {
          score: 92,
        },
        '5': {
          score: 99,
        },
      },
    },
    {
      id: 'm19',
      title: 'The Raid: Redemption',
      rt: '87%',
      ratings: {
        '1': {
          score: 92,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 98,
        },
      },
    },
    {
      id: 'm20',
      title: 'Zac Snyder&#39;s Justice League',
      rt: '71%',
      ratings: {
        '1': {
          score: 90,
        },
        '3': {
          score: 93,
        },
        '5': {
          score: 92,
        },
      },
    },
    {
      id: 'm21',
      title: 'Batman Begins',
      rt: '85%',
      ratings: {
        '1': {
          score: 91,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 93,
        },
      },
    },
    {
      id: 'm22',
      title: 'N T B T S T M',
      rt: '98%',
      ratings: {
        '1': {
          score: 91,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 92,
        },
      },
    },
    {
      id: 'm23',
      title: 'One Battle After Another',
      rt: '94%',
      ratings: {
        '1': {
          score: 91,
        },
        '2': {
          score: 90,
        },
        '3': {
          score: 92,
        },
        '6': {
          score: 90,
        },
      },
    },
    {
      id: 'm24',
      title: 'GZ -1',
      rt: '99%',
      ratings: {
        '1': {
          score: 90,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 92,
        },
      },
    },
    {
      id: 'm25',
      title: 'The Menu',
      ratings: {
        '1': {
          score: 92,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 95,
        },
      },
    },
    {
      id: 'm26',
      title: 'Fargo',
      rt: '94%',
      ratings: {
        '1': {
          score: 82,
        },
        '3': {
          score: 99,
        },
      },
    },
    {
      id: 'm27',
      title: 'Send Help',
      rt: '93%',
      ratings: {
        '1': {
          score: 90,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 91,
        },
      },
    },
    {
      id: 'm28',
      title: 'The Prestige',
      ratings: {
        '1': {
          score: 86,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 95,
        },
      },
    },
    {
      id: 'm29',
      title: '28 Years Later: The Bone Temple',
      rt: '92%',
      ratings: {
        '1': {
          score: 90,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 90,
        },
      },
    },
    {
      id: 'm30',
      title: 'Heretic',
      rt: '90%',
      ratings: {
        '1': {
          score: 92,
        },
        '2': {
          score: 91,
        },
        '3': {
          score: 86,
        },
        '6': {
          score: 87,
        },
      },
    },
    {
      id: 'm31',
      title: 'The Emperor&#39;s New Groove',
      rt: '86%',
      ratings: {
        '1': {
          score: 89,
        },
        '2': {
          score: 90,
        },
        '3': {
          score: 92,
        },
        '5': {
          score: 85,
        },
      },
    },
    {
      id: 'm32',
      title: 'Weapons',
      rt: '93%',
      ratings: {
        '1': {
          score: 86,
        },
        '2': {
          score: 91,
        },
        '3': {
          score: 98,
        },
        '6': {
          score: 80,
        },
      },
    },
    {
      id: 'm33',
      title: 'Evil Dead 2013',
      ratings: {
        '1': {
          score: 89,
        },
        '2': {
          score: 87,
        },
        '3': {
          score: 90,
        },
      },
    },
    {
      id: 'm34',
      title: 'Dredd',
      rt: '80%',
      ratings: {
        '1': {
          score: 92,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 89,
        },
      },
    },
    {
      id: 'm35',
      title: 'Blade Runner 2049 (2017)',
      rt: '88%',
      ratings: {
        '1': {
          score: 87,
        },
        '2': {
          score: 89,
        },
        '3': {
          score: 88,
        },
      },
    },
    {
      id: 'm36',
      title: 'Mission Impossible: Dead reckoning',
      rt: '96%',
      ratings: {
        '1': {
          score: 86,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 92,
        },
      },
    },
    {
      id: 'm37',
      title: '300',
      rt: '61%',
      ratings: {
        '1': {
          score: 90,
        },
        '3': {
          score: 85,
        },
      },
    },
    {
      id: 'm38',
      title: '28 Years Later',
      rt: '89%',
      ratings: {
        '1': {
          score: 87,
        },
        '3': {
          score: 88,
        },
      },
    },
    {
      id: 'm39',
      title: 'Bugonia',
      rt: '84%',
      ratings: {
        '1': {
          score: 88,
        },
        '2': {
          score: 91,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 84,
        },
      },
    },
    {
      id: 'm40',
      title: 'Hero',
      rt: '94%',
      ratings: {
        '1': {
          score: 83,
        },
        '2': {
          score: 88,
        },
        '3': {
          score: 90,
        },
      },
    },
    {
      id: 'm41',
      title: 'The Interview',
      rt: '51%',
      ratings: {
        '1': {
          score: 88,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 90,
        },
        '6': {
          score: 80,
        },
      },
    },
    {
      id: 'm42',
      title: 'Mission Impossible: Final Reckoning',
      rt: '80%',
      ratings: {
        '1': {
          score: 84,
        },
        '3': {
          score: 82,
        },
        '5': {
          score: 95,
        },
      },
    },
    {
      id: 'm43',
      title: 'Us',
      rt: '93%',
      ratings: {
        '1': {
          score: 88,
        },
        '2': {
          score: 84,
        },
        '3': {
          score: 88,
        },
      },
    },
    {
      id: 'm44',
      title: 'Wake Up Dead Man: A Knives Out Mystery',
      rt: '94%',
      ratings: {
        '1': {
          score: 90,
        },
        '2': {
          score: 86,
        },
        '3': {
          score: 82,
        },
        '5': {
          score: 88,
        },
      },
    },
    {
      id: 'm45',
      title: 'This is the End',
      rt: '82%',
      ratings: {
        '1': {
          score: 88,
        },
        '3': {
          score: 89,
        },
        '5': {
          score: 90,
        },
        '6': {
          score: 79,
        },
      },
    },
    {
      id: 'm46',
      title: 'Talk to me',
      rt: '94%',
      ratings: {
        '1': {
          score: 77,
        },
        '2': {
          score: 86,
        },
        '3': {
          score: 92,
        },
        '6': {
          score: 90,
        },
      },
    },
    {
      id: 'm47',
      title: 'The First Omen',
      rt: '83%',
      ratings: {
        '1': {
          score: 83,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 85,
        },
      },
    },
    {
      id: 'm48',
      title: 'Evil Dead Rise',
      rt: '85%',
      ratings: {
        '1': {
          score: 89,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 83,
        },
      },
    },
    {
      id: 'm49',
      title: 'Arrival',
      rt: '85%',
      ratings: {
        '1': {
          score: 86,
        },
        '3': {
          score: 86,
        },
        '5': {
          score: 84,
        },
      },
    },
    {
      id: 'm50',
      title: 'Planes, Trains and Automobiles',
      rt: '93%',
      ratings: {
        '1': {
          score: 85,
        },
        '3': {
          score: 87,
        },
        '5': {
          score: 84,
        },
      },
    },
    {
      id: 'm51',
      title: 'Chris Walken through the Jungle',
      ratings: {
        '1': {
          score: 89,
        },
        '3': {
          score: 78,
        },
        '5': {
          score: 88,
        },
      },
    },
    {
      id: 'm52',
      title: 'Due Date',
      rt: '39%',
      ratings: {
        '1': {
          score: 86,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 84,
        },
      },
    },
    {
      id: 'm53',
      title: 'The Long Walk',
      rt: '85%',
      ratings: {
        '1': {
          score: 82,
        },
        '3': {
          score: 82,
        },
        '5': {
          score: 91,
        },
      },
    },
    {
      id: 'm54',
      title: 'Alita Battle Angel',
      rt: '61%',
      ratings: {
        '1': {
          score: 88,
        },
        '2': {
          score: 84,
        },
        '3': {
          score: 80,
        },
        '5': {
          score: 87,
        },
      },
    },
    {
      id: 'm55',
      title: 'NehZha2',
      rt: '92%',
      ratings: {
        '1': {
          score: 91,
        },
        '2': {
          score: 78,
        },
      },
    },
    {
      id: 'm56',
      title: 'Sinners',
      rt: '97%',
      ratings: {
        '1': {
          score: 90,
        },
        '2': {
          score: 82,
        },
        '3': {
          score: 84,
        },
        '6': {
          score: 80,
        },
      },
    },
    {
      id: 'm57',
      title: 'Demon Slayer: Mugen Train',
      rt: '98%',
      ratings: {
        '1': {
          score: 88,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 88,
        },
        '6': {
          score: 75,
        },
      },
    },
    {
      id: 'm58',
      title: 'No Other Choice',
      rt: '97%',
      ratings: {
        '1': {
          score: 84,
        },
        '3': {
          score: 84,
        },
        '5': {
          score: 84,
        },
      },
    },
    {
      id: 'm59',
      title: 'Cold Storage',
      rt: '78%',
      ratings: {
        '1': {
          score: 82,
        },
        '3': {
          score: 82,
        },
        '5': {
          score: 88,
        },
      },
    },
    {
      id: 'm60',
      title: 'Predator: Badlands',
      rt: '86%',
      ratings: {
        '1': {
          score: 89,
        },
        '2': {
          score: 87,
        },
        '3': {
          score: 75,
        },
      },
    },
    {
      id: 'm61',
      title: 'Incredibles 2',
      rt: '93%',
      ratings: {
        '1': {
          score: 80,
        },
        '3': {
          score: 80,
        },
        '5': {
          score: 91,
        },
      },
    },
    {
      id: 'm62',
      title: 'Man of Steel',
      rt: '57%',
      ratings: {
        '1': {
          score: 88,
        },
        '3': {
          score: 82,
        },
        '5': {
          score: 79,
        },
      },
    },
    {
      id: 'm63',
      title: 'KPop DH',
      rt: '96%',
      ratings: {
        '1': {
          score: 74,
        },
        '2': {
          score: 80,
        },
        '5': {
          score: 93,
        },
      },
    },
    {
      id: 'm64',
      title: 'Dracula A Love Tale',
      ratings: {
        '1': {
          score: 88,
        },
        '3': {
          score: 75,
        },
        '5': {
          score: 84,
        },
      },
    },
    {
      id: 'm65',
      title: 'The Revenant',
      rt: '78%',
      ratings: {
        '1': {
          score: 74,
        },
        '2': {
          score: 79,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 88,
        },
      },
    },
    {
      id: 'm66',
      title: 'Companion',
      ratings: {
        '1': {
          score: 82,
        },
        '2': {
          score: 80,
        },
        '3': {
          score: 82,
        },
        '5': {
          score: 81,
        },
      },
    },
    {
      id: 'm67',
      title: 'Anaconda',
      rt: '48%',
      ratings: {
        '1': {
          score: 82,
        },
        '2': {
          score: 85,
        },
        '3': {
          score: 72,
        },
        '5': {
          score: 85,
        },
      },
    },
    {
      id: 'm68',
      title: 'The Raid 2',
      rt: '82%',
      ratings: {
        '1': {
          score: 75,
        },
        '3': {
          score: 75,
        },
        '5': {
          score: 90,
        },
      },
    },
    {
      id: 'm69',
      title: 'Eternal Sunshine',
      ratings: {
        '1': {
          score: 80,
        },
        '3': {
          score: 78,
        },
        '5': {
          score: 82,
        },
      },
    },
    {
      id: 'm70',
      title: 'Annihilation',
      rt: '88%',
      ratings: {
        '1': {
          score: 74,
        },
        '3': {
          score: 80,
        },
        '5': {
          score: 86,
        },
      },
    },
    {
      id: 'm71',
      title: 'Alien Romulus',
      rt: '80%',
      ratings: {
        '1': {
          score: 86,
        },
        '2': {
          score: 79,
        },
        '3': {
          score: 74,
        },
      },
    },
    {
      id: 'm72',
      title: 'Brodrickzilla',
      rt: '20%',
      ratings: {
        '1': {
          score: 85,
        },
        '3': {
          score: 72,
        },
        '5': {
          score: 82,
        },
      },
    },
    {
      id: 'm73',
      title: 'Batman vs Superman',
      rt: '28%',
      ratings: {
        '1': {
          score: 75,
        },
        '3': {
          score: 75,
        },
        '5': {
          score: 84,
        },
      },
    },
    {
      id: 'm74',
      title: 'Pluribus S1',
      rt: '98%',
      ratings: {
        '1': {
          score: 76,
        },
        '2': {
          score: 82,
        },
        '3': {
          score: 75,
        },
      },
    },
    {
      id: 'm75',
      title: 'Frankenstein',
      rt: '85%',
      ratings: {
        '1': {
          score: 70,
        },
        '2': {
          score: 80,
        },
        '3': {
          score: 80,
        },
        '5': {
          score: 79,
        },
      },
    },
    {
      id: 'm76',
      title: 'Children of Men',
      ratings: {
        '1': {
          score: 74,
        },
        '3': {
          score: 80,
        },
        '5': {
          score: 77,
        },
      },
    },
    {
      id: 'm77',
      title: 'Ghost in the Shell',
      rt: '95%',
      ratings: {
        '1': {
          score: 75,
        },
        '3': {
          score: 80,
        },
        '5': {
          score: 75,
        },
      },
    },
    {
      id: 'm78',
      title: 'The Batman',
      rt: '85%',
      ratings: {
        '1': {
          score: 64,
        },
        '2': {
          score: 74,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 78,
        },
      },
    },
    {
      id: 'm79',
      title: 'The Illusionist',
      ratings: {
        '1': {
          score: 74,
        },
        '3': {
          score: 75,
        },
        '5': {
          score: 80,
        },
      },
    },
    {
      id: 'm80',
      title: 'Memento',
      rt: '93%',
      ratings: {
        '1': {
          score: 70,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 74,
        },
      },
    },
    {
      id: 'm81',
      title: 'Prey',
      rt: '94%',
      ratings: {
        '1': {
          score: 75,
        },
        '2': {
          score: 75,
        },
        '3': {
          score: 78,
        },
      },
    },
    {
      id: 'm82',
      title: 'Together',
      rt: '90%',
      ratings: {
        '1': {
          score: 81,
        },
        '3': {
          score: 78,
        },
        '5': {
          score: 69,
        },
      },
    },
    {
      id: 'm83',
      title: 'Audition',
      rt: '81%',
      ratings: {
        '1': {
          score: 76,
        },
        '3': {
          score: 80,
        },
        '5': {
          score: 72,
        },
      },
    },
    {
      id: 'm84',
      title: 'Superman 2025',
      rt: '83%',
      ratings: {
        '1': {
          score: 74,
        },
        '3': {
          score: 78,
        },
      },
    },
    {
      id: 'm85',
      title: 'Good Fortune',
      rt: '79%',
      ratings: {
        '1': {
          score: 72,
        },
        '2': {
          score: 79,
        },
        '3': {
          score: 75,
        },
        '5': {
          score: 77,
        },
      },
    },
    {
      id: 'm86',
      title: 'Sisu',
      rt: '94%',
      ratings: {
        '1': {
          score: 77,
        },
        '2': {
          score: 77,
        },
        '3': {
          score: 75,
        },
        '5': {
          score: 74,
        },
      },
    },
    {
      id: 'm87',
      title: 'Blade 1',
      rt: '59%',
      ratings: {
        '1': {
          score: 72,
        },
        '2': {
          score: 83,
        },
        '3': {
          score: 72,
        },
      },
    },
    {
      id: 'm88',
      title: 'Demon Slayer: Infinity naps',
      rt: '98%',
      ratings: {
        '1': {
          score: 74,
        },
        '3': {
          score: 75,
        },
        '5': {
          score: 78,
        },
      },
    },
    {
      id: 'm89',
      title: 'Daredevil: Born Again',
      rt: '87%',
      ratings: {
        '1': {
          score: 75,
        },
        '3': {
          score: 74,
        },
        '5': {
          score: 78,
        },
      },
    },
    {
      id: 'm90',
      title: 'Peaky Blinders: The Show The Movie',
      ratings: {
        '1': {
          score: 70,
        },
        '3': {
          score: 70,
        },
        '5': {
          score: 85,
        },
      },
    },
    {
      id: 'm91',
      title: 'Exit 9',
      ratings: {
        '1': {
          score: 70,
        },
        '3': {
          score: 69,
        },
        '5': {
          score: 85,
        },
      },
    },
    {
      id: 'm92',
      title: 'Until Dawn',
      rt: '52%',
      ratings: {
        '1': {
          score: 75,
        },
        '3': {
          score: 72,
        },
        '5': {
          score: 77,
        },
      },
    },
    {
      id: 'm93',
      title: 'The End of Evangelion',
      ratings: {
        '1': {
          score: 70,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 69,
        },
      },
    },
    {
      id: 'm94',
      title: 'Van Helsing',
      rt: '34%',
      ratings: {
        '1': {
          score: 80,
        },
        '2': {
          score: 73,
        },
        '3': {
          score: 70,
        },
      },
    },
    {
      id: 'm95',
      title: 'Roofman',
      rt: '85%',
      ratings: {
        '1': {
          score: 75,
        },
        '3': {
          score: 72,
        },
        '5': {
          score: 75,
        },
      },
    },
    {
      id: 'm96',
      title: 'Chainsaw Man: Reze Arc',
      rt: '96%',
      ratings: {
        '1': {
          score: 73,
        },
        '2': {
          score: 78,
        },
        '3': {
          score: 70,
        },
      },
    },
    {
      id: 'm97',
      title: 'Jumper',
      rt: '15%',
      ratings: {
        '1': {
          score: 70,
        },
        '2': {
          score: 75,
        },
        '3': {
          score: 69,
        },
        '5': {
          score: 78,
        },
      },
    },
    {
      id: 'm98',
      title: 'Tenet',
      rt: '70%',
      ratings: {
        '1': {
          score: 74,
        },
        '3': {
          score: 70,
        },
        '5': {
          score: 75,
        },
      },
    },
    {
      id: 'm99',
      title: 'Speak No Evil (English)',
      rt: '83%',
      ratings: {
        '1': {
          score: 70,
        },
        '2': {
          score: 73,
        },
        '3': {
          score: 74,
        },
      },
    },
    {
      id: 'm100',
      title: 'League of Extrordinary GM',
      rt: '17%',
      ratings: {
        '1': {
          score: 77,
        },
        '2': {
          score: 72,
        },
        '3': {
          score: 68,
        },
      },
    },
    {
      id: 'm101',
      title: 'Godzilla (2014)',
      rt: '76%',
      ratings: {
        '1': {
          score: 75,
        },
        '3': {
          score: 70,
        },
        '5': {
          score: 70,
        },
      },
    },
    {
      id: 'm102',
      title: 'The Substance',
      rt: '89%',
      ratings: {
        '1': {
          score: 70,
        },
        '2': {
          score: 78,
        },
        '3': {
          score: 74,
        },
        '6': {
          score: 60,
        },
      },
    },
    {
      id: 'm103',
      title: 'mummy',
      ratings: {
        '1': {
          score: 69,
        },
        '2': {
          score: 70,
        },
        '3': {
          score: 78,
        },
        '5': {
          score: 65,
        },
      },
    },
    {
      id: 'm104',
      title: 'Mystery Men',
      rt: '59%',
      ratings: {
        '1': {
          score: 72,
        },
        '2': {
          score: 71,
        },
        '3': {
          score: 68,
        },
      },
    },
    {
      id: 'm105',
      title: 'Primate',
      rt: '78%',
      ratings: {
        '1': {
          score: 73,
        },
        '3': {
          score: 69,
        },
        '5': {
          score: 69,
        },
      },
    },
    {
      id: 'm106',
      title: 'Dad Machine',
      rt: '71%',
      ratings: {
        '1': {
          score: 68,
        },
        '3': {
          score: 68,
        },
        '5': {
          score: 72,
        },
      },
    },
    {
      id: 'm107',
      title: 'Nobody2',
      rt: '77%',
      ratings: {
        '1': {
          score: 70,
        },
        '2': {
          score: 75,
        },
        '3': {
          score: 62,
        },
      },
    },
    {
      id: 'm108',
      title: 'Scarlet',
      rt: '72%',
      ratings: {
        '1': {
          score: 69,
        },
        '3': {
          score: 70,
        },
        '5': {
          score: 72,
        },
        '6': {
          score: 65,
        },
      },
    },
    {
      id: 'm109',
      title: 'Terminal',
      rt: '22%',
      ratings: {
        '1': {
          score: 73,
        },
        '3': {
          score: 65,
        },
      },
    },
    {
      id: 'm110',
      title: 'Good Boy',
      rt: '90%',
      ratings: {
        '1': {
          score: 70,
        },
        '2': {
          score: 67,
        },
        '3': {
          score: 65,
        },
        '5': {
          score: 72,
        },
      },
    },
    {
      id: 'm111',
      title: 'Caught Stealing',
      rt: '84%',
      ratings: {
        '1': {
          score: 74,
        },
        '2': {
          score: 72,
        },
        '3': {
          score: 58,
        },
      },
    },
    {
      id: 'm112',
      title: 'Nobody',
      rt: '83%',
      ratings: {
        '1': {
          score: 70,
        },
        '2': {
          score: 65,
        },
        '3': {
          score: 68,
        },
      },
    },
    {
      id: 'm113',
      title: 'Minecraft Movie',
      rt: '47%',
      ratings: {
        '1': {
          score: 68,
        },
        '2': {
          score: 74,
        },
        '3': {
          score: 58,
        },
      },
    },
    {
      id: 'm114',
      title: 'Spawn',
      rt: '17%',
      ratings: {
        '1': {
          score: 60,
        },
        '3': {
          score: 70,
        },
        '5': {
          score: 69,
        },
      },
    },
    {
      id: 'm115',
      title: 'Sisu 2',
      rt: '95%',
      ratings: {
        '1': {
          score: 66,
        },
        '2': {
          score: 61,
        },
        '3': {
          score: 70,
        },
        '5': {
          score: 68,
        },
      },
    },
    {
      id: 'm116',
      title: 'Mickey 17',
      rt: '78%',
      ratings: {
        '1': {
          score: 66,
        },
        '2': {
          score: 64,
        },
      },
    },
    {
      id: 'm117',
      title: 'We Bury the dead',
      rt: '88%',
      ratings: {
        '1': {
          score: 63,
        },
        '3': {
          score: 68,
        },
        '5': {
          score: 63,
        },
      },
    },
    {
      id: 'm118',
      title: 'The Fantastic Four: First Steps',
      rt: '86%',
      ratings: {
        '1': {
          score: 64,
        },
        '2': {
          score: 55,
        },
        '3': {
          score: 74,
        },
      },
    },
    {
      id: 'm119',
      title: 'Five Nights At Freddy&#39;s 2',
      rt: '16%',
      ratings: {
        '1': {
          score: 62,
        },
        '2': {
          score: 66,
        },
        '3': {
          score: 60,
        },
        '5': {
          score: 67,
        },
      },
    },
    {
      id: 'm120',
      title: 'I, Frankenstein',
      rt: '5%',
      ratings: {
        '1': {
          score: 69,
        },
        '2': {
          score: 57,
        },
      },
    },
    {
      id: 'm121',
      title: 'Reawakening',
      rt: '82%',
      ratings: {
        '1': {
          score: 68,
        },
        '3': {
          score: 68,
        },
        '5': {
          score: 52,
        },
      },
    },
    {
      id: 'm122',
      title: 'StrangerThings S5',
      rt: '84%',
      ratings: {
        '1': {
          score: 60,
        },
        '2': {
          score: 67,
        },
        '3': {
          score: 60,
        },
      },
    },
    {
      id: 'm123',
      title: 'TRON:Ares',
      rt: '53%',
      ratings: {
        '1': {
          score: 60,
        },
        '2': {
          score: 69,
        },
        '3': {
          score: 56,
        },
      },
    },
    {
      id: 'm124',
      title: 'CRIME 101',
      ratings: {
        '1': {
          score: 58,
        },
        '2': {
          score: 62,
        },
        '3': {
          score: 59,
        },
        '5': {
          score: 60,
        },
      },
    },
    {
      id: 'm125',
      title: 'The Watchers',
      rt: '32%',
      ratings: {
        '1': {
          score: 58,
        },
        '2': {
          score: 61,
        },
        '3': {
          score: 58,
        },
      },
    },
    {
      id: 'm126',
      title: 'Eddington',
      rt: '69%',
      ratings: {
        '1': {
          score: 45,
        },
        '2': {
          score: 51,
        },
        '3': {
          score: 60,
        },
      },
    },
    {
      id: 'm127',
      title: 'Shin Godzilla',
      rt: '86%',
      ratings: {
        '1': {
          score: 50,
        },
        '3': {
          score: 80,
        },
        '5': {
          score: 25,
        },
      },
    },
    {
      id: 'm128',
      title: 'The Running Man 2025',
      rt: '63%',
      ratings: {
        '1': {
          score: 40,
        },
        '2': {
          score: 64,
        },
        '3': {
          score: 50,
        },
      },
    },
    {
      id: 'm129',
      title: 'Mercy',
      rt: '25%',
      ratings: {
        '1': {
          score: 50,
        },
        '3': {
          score: 50,
        },
        '5': {
          score: 41,
        },
      },
    },
    {
      id: 'm130',
      title: 'In The Shadow of the Moon',
      rt: '50%',
      ratings: {
        '1': {
          score: 39,
        },
        '3': {
          score: 49,
        },
        '5': {
          score: 35,
        },
      },
    },
    {
      id: 'm131',
      title: 'Mortal Kombat II',
      ratings: {
        '1': {
          score: 76,
        },
        '2': {
          score: 87,
        },
        '3': {
          score: 72,
        },
        '5': {
          score: 80,
        },
      },
    },
    {
      id: 'm132',
      title: 'They Will Kill You',
      ratings: {
        '1': {
          score: 90,
        },
        '2': {
          score: 90,
        },
        '3': {
          score: 85,
        },
        '5': {
          score: 92,
        },
      },
    },
    {
      id: 'm133',
      title: 'Ready or Not: Here I Come',
      ratings: {
        '1': {
          score: 77,
        },
        '3': {
          score: 78,
        },
        '5': {
          score: 80,
        },
      },
    },
    {
      id: 'm134',
      title: 'The Super Mario Galaxy Movie',
      ratings: {
        '1': {
          score: 75,
        },
        '3': {
          score: 75,
        },
        '5': {
          score: 85,
        },
      },
    },
    {
      id: 'm135',
      title: 'Undertone',
      ratings: {
        '1': {
          score: 80,
        },
        '3': {
          score: 82,
        },
        '5': {
          score: 85,
        },
      },
    },
    {
      id: 'm136',
      title: 'Napoleon Dynamite',
      ratings: {
        '1': {
          score: 88,
        },
        '3': {
          score: 90,
        },
        '5': {
          score: 88,
        },
      },
    },
    {
      id: 'm137',
      title: 'Shanghai Knights',
      ratings: {
        '1': {
          score: 93,
        },
        '3': {
          score: 92,
        },
        '5': {
          score: 94,
        },
      },
    },
    {
      id: 'm138',
      title: 'Waiting',
      ratings: {
        '1': {
          score: 94,
        },
        '3': {
          score: 90,
        },
      },
    },
    {
      id: 'm139',
      title: 'The Mist',
      ratings: {
        '1': {
          score: 82,
        },
        '3': {
          score: 82,
        },
      },
    },
    {
      id: 'm140',
      title: 'V for Vendetta',
      ratings: {
        '1': {
          score: 85,
        },
        '3': {
          score: 90,
        },
      },
    },
  ],
  watchlist: [
    {
      id: 'w0',
      title: 'The Big Lebowski',
      rt: '94%',
      votes: [],
    },
    {
      id: 'w1',
      title: '300',
      rt: '88%',
      votes: [],
    },
    {
      id: 'w2',
      title: 'No Country for Old Men',
      rt: '86%',
      votes: [],
    },
    {
      id: 'w3',
      title: 'Ex Machina',
      rt: '86%',
      votes: [],
    },
    {
      id: 'w4',
      title: '28 Days Later',
      rt: '85%',
      votes: [],
    },
    {
      id: 'w5',
      title: 'The Revenant',
      rt: '84%',
      votes: [],
    },
    {
      id: 'w6',
      title: 'Upgrade',
      rt: '83%',
      votes: [],
    },
    {
      id: 'w7',
      title: 'Arrival',
      rt: '82%',
      votes: [],
    },
    {
      id: 'w8',
      title: 'Arcadian',
      rt: '81%',
      votes: [],
    },
    {
      id: 'w9',
      title: 'Blade Runner 2049',
      rt: '81%',
      votes: [],
    },
    {
      id: 'w10',
      title: 'Dredd',
      rt: '78%',
      votes: [],
    },
    {
      id: 'w11',
      title: '28 Weeks Later',
      rt: '74%',
      votes: [],
    },
    {
      id: 'w12',
      title: 'Snowpiercer',
      rt: '73%',
      votes: [],
    },
    {
      id: 'w13',
      title: 'The Girl with All the Gifts',
      rt: '72%',
      votes: [],
    },
    {
      id: 'w14',
      title: 'Wyrmwood: Road of the Dead',
      rt: '70%',
      votes: [],
    },
    {
      id: 'w15',
      title: 'The Lobster',
      rt: '69%',
      votes: [],
    },
    {
      id: 'w16',
      title: 'Event Horizon',
      rt: '68%',
      votes: [],
    },
    {
      id: 'w17',
      title: 'Hereditary',
      rt: '67%',
      votes: [],
    },
    {
      id: 'w18',
      title: 'Annihilation',
      rt: '65%',
      votes: [],
    },
    {
      id: 'w19',
      title: 'Blade (Trilogy Average)',
      rt: '64%',
      votes: [],
    },
    {
      id: 'w20',
      title: 'Enemy',
      rt: '59%',
      votes: [],
    },
    {
      id: 'w21',
      title: 'The Road',
      rt: '58%',
      votes: [],
    },
    {
      id: 'w22',
      title: 'Dracula Untold',
      rt: '49%',
      votes: [],
    },
    {
      id: 'w23',
      title: 'Outlander (2008)',
      rt: '46%',
      votes: [],
    },
    {
      id: 'w24',
      title: 'Solomon Kane',
      rt: '45%',
      votes: [],
    },
    {
      id: 'w25',
      title: 'The Canal',
      rt: '44%',
      votes: [],
    },
    {
      id: 'w26',
      title: 'The Awakening',
      rt: '43%',
      votes: [],
    },
    {
      id: 'w27',
      title: 'Sahara',
      rt: '42%',
      votes: [],
    },
    {
      id: 'w28',
      title: 'The Hallow',
      rt: '41%',
      votes: [],
    },
    {
      id: 'w29',
      title: 'I, Frankenstein',
      rt: '35%',
      votes: [],
    },
    {
      id: 'w30',
      title: 'Legion',
      rt: '27%',
      votes: [],
    },
    {
      id: 'w31',
      title: 'The Pyramid',
      rt: '20%',
      votes: [],
    },
    {
      id: 'w32',
      title: 'Season of the Witch',
      rt: '18%',
      votes: [],
    },
    {
      id: 'w33',
      title: 'The Incredibles',
      votes: [],
    },
    {
      id: 'w34',
      title: 'terminators',
      votes: [],
    },
    {
      id: 'w35',
      title: 'resident evils',
      votes: [],
    },
    {
      id: 'w36',
      title: 'king kong',
      votes: [],
    },
    {
      id: 'w37',
      title: '10000 BC',
      votes: [],
    },
    {
      id: 'w38',
      title: 'excalibur',
      votes: [],
    },
    {
      id: 'w39',
      title: 'looper',
      votes: [],
    },
    {
      id: 'w40',
      title: 'Bring her back',
      votes: [],
    },
    {
      id: 'w41',
      title: 'prometheus',
      votes: [],
    },
    {
      id: 'w42',
      title: 'Shanghai Knights',
      votes: [],
    },
    {
      id: 'w43',
      title: 'Shanghai Noon',
      votes: [],
    },
    {
      id: 'w44',
      title: 'Dark Knight',
      votes: [],
    },
    {
      id: 'w45',
      title: 'soylent green',
      votes: [],
    },
    {
      id: 'w46',
      title: 'oddity',
      votes: [],
    },
    {
      id: 'w47',
      title: 'companion',
      votes: [],
    },
    {
      id: 'w48',
      title: 'ghost in the shell',
      votes: [],
    },
    {
      id: 'w49',
      title: 'sunshine',
      votes: [],
    },
    {
      id: 'w50',
      title: 'deer hunter',
      votes: [],
    },
    {
      id: 'w51',
      title: 'Evil dead 2013',
      votes: [],
    },
    {
      id: 'w52',
      title: 'Austin Powers',
      votes: [],
    },
    {
      id: 'w53',
      title: 'Waiting',
      votes: [],
    },
    {
      id: 'w54',
      title: 'Dodgeball',
      votes: [],
    },
    {
      id: 'w55',
      title: 'Die another day',
      votes: [],
    },
    {
      id: 'w56',
      title: 'Coyotes',
      votes: [],
    },
    {
      id: 'w57',
      title: 'The Shawshank Redemption',
      votes: [],
    },
    {
      id: 'w58',
      title: 'Tenet',
      votes: [],
    },
    {
      id: 'w59',
      title: 'shrek',
      votes: [],
    },
    {
      id: 'w60',
      title: 'spy kids',
      votes: [],
    },
    {
      id: 'w61',
      title: 'The Invisible Man',
      votes: [],
    },
    {
      id: 'w62',
      title: 'Cast Away',
      votes: [],
    },
    {
      id: 'w63',
      title: 'The Good, The Bad, The Ugly',
      votes: [],
    },
    {
      id: 'w64',
      title: 'Fight Club',
      votes: [],
    },
    {
      id: 'w65',
      title: 'The Matrix',
      votes: [],
    },
    {
      id: 'w66',
      title: 'Interstellar',
      votes: [],
    },
    {
      id: 'w67',
      title: 'American History X',
      votes: [],
    },
    {
      id: 'w68',
      title: 'The Usual Suspects',
      votes: [],
    },
    {
      id: 'w69',
      title: 'Memento',
      votes: [],
    },
    {
      id: 'w70',
      title: '2001: A Space Oddessy',
      votes: [],
    },
    {
      id: 'w71',
      title: 'Indiana Jones Movies',
      votes: [],
    },
    {
      id: 'w72',
      title: 'Wolf of Wall Street',
      votes: [],
    },
    {
      id: 'w73',
      title: 'There will be Blood',
      votes: [],
    },
    {
      id: 'w74',
      title: 'Shutter Island',
      votes: [],
    },
    {
      id: 'w75',
      title: '12 years a slave',
      votes: [],
    },
    {
      id: 'w76',
      title: 'million dollar baby',
      votes: [],
    },
    {
      id: 'w77',
      title: 'The Iron Giant',
      votes: [],
    },
    {
      id: 'w78',
      title: 'Gone Girl',
      votes: [],
    },
    {
      id: 'w79',
      title: 'The Sixth Sense',
      votes: [],
    },
    {
      id: 'w80',
      title: 'Resevoir Dogs',
      votes: [],
    },
    {
      id: 'w81',
      title: 'Eternal Sunshine of the Spotless Mind',
      votes: [],
    },
    {
      id: 'w82',
      title: 'The Truman Show',
      votes: [],
    },
    {
      id: 'w83',
      title: 'The Silence of the Lambs',
      votes: [],
    },
    {
      id: 'w84',
      title: 'Se7en',
      votes: [],
    },
    {
      id: 'w85',
      title: 'Requiem for a Dream',
      votes: [],
    },
    {
      id: 'w86',
      title: 'The Departed',
      votes: [],
    },
    {
      id: 'w87',
      title: 'Gangs of New York',
      votes: [],
    },
    {
      id: 'w88',
      title: 'Training Day',
      votes: [],
    },
    {
      id: 'w89',
      title: 'The Patriot',
      votes: [],
    },
    {
      id: 'w90',
      title: 'The Last of the Mohicans',
      votes: [],
    },
    {
      id: 'w91',
      title: 'Pulp fiction',
      votes: [],
    },
    {
      id: 'w92',
      title: 'Minority report',
      votes: [],
    },
    {
      id: 'w93',
      title: 'Neighbours',
      votes: [],
    },
    {
      id: 'w94',
      title: 'Superbad',
      votes: [],
    },
    {
      id: 'w95',
      title: 'They will kill you',
      votes: [],
    },
    {
      id: 'w96',
      title: 'GZ -1',
      votes: [],
    },
    {
      id: 'w97',
      title: 'BrodrickZilla',
      votes: [],
    },
    {
      id: 'w98',
      title: 'Breaking BadZilla',
      votes: [],
    },
    {
      id: 'w99',
      title: 'Boardroom Simulator',
      votes: [],
    },
    {
      id: 'w100',
      title: 'kinda of kindness',
      votes: [],
    },
  ],
}
