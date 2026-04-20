import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'data', 'black-map-snapshot.json');
const outlinePath = path.join(repoRoot, 'background', 'bulgaria-outline.json');

const SOURCE_URL = 'https://d3g9kruk81dvbk.cloudfront.net/public/statistics.json';
const GRID = Object.freeze({ cols: 58, rows: 34 });
const MAP_MARGIN = 0.35;

const ROAD_CLASS_LABELS = Object.freeze({
  0: 'Градска/неуточнена мрежа',
  1121: 'Автомагистрала',
  1122: 'Първокласен път',
  1123: 'Второкласен път',
  1124: 'Третокласен път',
  1125: 'Общински път',
  1126: 'Частен път',
  1127: 'Горски път',
  1128: 'Земеделски път',
  1130: 'Пътна връзка',
  5907: 'Скоростен участък',
});

const CITY_HINTS = Object.freeze([
  { name: 'София', lat: 42.6977, lng: 23.3219 },
  { name: 'Пловдив', lat: 42.1354, lng: 24.7453 },
  { name: 'Варна', lat: 43.2141, lng: 27.9147 },
  { name: 'Бургас', lat: 42.5048, lng: 27.4626 },
  { name: 'Русе', lat: 43.8356, lng: 25.9657 },
  { name: 'Стара Загора', lat: 42.4258, lng: 25.6345 },
  { name: 'Плевен', lat: 43.417, lng: 24.6067 },
  { name: 'Благоевград', lat: 42.0209, lng: 23.0943 },
  { name: 'Велико Търново', lat: 43.0757, lng: 25.6172 },
  { name: 'Шумен', lat: 43.2712, lng: 26.9361 },
  { name: 'Сливен', lat: 42.6819, lng: 26.3229 },
  { name: 'Хасково', lat: 41.9347, lng: 25.5556 },
  { name: 'Добрич', lat: 43.5726, lng: 27.8273 },
  { name: 'Видин', lat: 43.9962, lng: 22.8679 },
  { name: 'Монтана', lat: 43.4125, lng: 23.2254 },
  { name: 'Кърджали', lat: 41.6505, lng: 25.3662 },
  { name: 'Смолян', lat: 41.5774, lng: 24.7127 },
  { name: 'Ямбол', lat: 42.4849, lng: 26.5035 },
]);

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return Number.parseFloat(value) || 0;
  return 0;
}

function toInt(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === 'string') return Number.parseInt(value, 10) || 0;
  return 0;
}

function createStatsBucket() {
  return {
    total: 0,
    major: 0,
    minor: 0,
    died: 0,
    injured: 0,
  };
}

function addToStats(bucket, record) {
  bucket.total += 1;
  bucket.major += record.isMajor ? 1 : 0;
  bucket.minor += record.isMajor ? 0 : 1;
  bucket.died += record.died;
  bucket.injured += record.injured;
}

function finalizeStats(bucket) {
  return {
    ...bucket,
    majorRate: bucket.total ? Number(((bucket.major / bucket.total) * 100).toFixed(1)) : 0,
  };
}

function getBounds(points) {
  return points.reduce((accumulator, [lat, lng]) => ({
    minLat: Math.min(accumulator.minLat, lat),
    maxLat: Math.max(accumulator.maxLat, lat),
    minLng: Math.min(accumulator.minLng, lng),
    maxLng: Math.max(accumulator.maxLng, lng),
  }), {
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  });
}

function isMappableRecord(record, bounds) {
  if (!Number.isFinite(record.lat) || !Number.isFinite(record.lng)) {
    return false;
  }

  return (
    record.lat >= (bounds.minLat - MAP_MARGIN) &&
    record.lat <= (bounds.maxLat + MAP_MARGIN) &&
    record.lng >= (bounds.minLng - MAP_MARGIN) &&
    record.lng <= (bounds.maxLng + MAP_MARGIN)
  );
}

function monthIndex(month) {
  return month >= 1 && month <= 12 ? month - 1 : null;
}

function hourIndex(hour) {
  return hour >= 0 && hour <= 23 ? hour : null;
}

function reactionWeight(record) {
  return 1 + (record.isMajor ? 2.6 : 0) + (record.died * 4.2) + (record.injured * 1.4);
}

function ensureGridBucket(map, x, y) {
  const key = `${x}:${y}`;
  const existing = map.get(key);
  if (existing) return existing;

  const bucket = {
    x,
    y,
    total: 0,
    major: 0,
    died: 0,
    injured: 0,
    weight: 0,
  };
  map.set(key, bucket);
  return bucket;
}

function translateRoadClass(roadClassId, lookup) {
  if (ROAD_CLASS_LABELS[roadClassId]) {
    return ROAD_CLASS_LABELS[roadClassId];
  }

  if (lookup && typeof lookup === 'string' && lookup.trim()) {
    return lookup.trim();
  }

  return roadClassId === 0 ? ROAD_CLASS_LABELS[0] : `Клас ${roadClassId}`;
}

function findNearestCity(lat, lng) {
  let nearest = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const city of CITY_HINTS) {
    const distance = Math.hypot(city.lat - lat, city.lng - lng);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = city;
    }
  }

  if (!nearest) return 'Неозначен район';
  if (bestDistance <= 0.45) return nearest.name;
  if (bestDistance <= 0.95) return `района на ${nearest.name}`;
  return `широк район ${nearest.name}`;
}

async function loadSourceJson(inputPath) {
  if (inputPath) {
    const fileContents = await fs.readFile(path.resolve(inputPath), 'utf8');
    return JSON.parse(fileContents);
  }

  const response = await fetch(SOURCE_URL, {
    headers: {
      'cache-control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch statistics source: HTTP ${response.status}`);
  }

  return response.json();
}

async function main() {
  const inputPath = process.argv[2];
  const [rawJson, outlinePoints] = await Promise.all([
    loadSourceJson(inputPath),
    fs.readFile(outlinePath, 'utf8').then(JSON.parse),
  ]);

  if (!Array.isArray(outlinePoints) || !outlinePoints.length) {
    throw new Error('Bulgaria outline is missing or invalid.');
  }

  const sourceYears = new Set((rawJson.meta?.years || []).map(toInt).filter(Boolean));
  const roadClassLookup = rawJson.lookups?.roadClasses || {};
  const outlineBounds = getBounds(outlinePoints);
  const latRange = outlineBounds.maxLat - outlineBounds.minLat;
  const lngRange = outlineBounds.maxLng - outlineBounds.minLng;

  const processed = [];
  for (const row of rawJson.data || []) {
    const record = {
      lat: toNumber(row[0]),
      lng: toNumber(row[1]),
      isMajor: toInt(row[2]) === 1,
      year: toInt(row[3]),
      month: toInt(row[4]),
      day: toInt(row[5]),
      hour: toInt(row[6]),
      roadClassId: toInt(row[7]),
      died: toInt(row[8]),
      injured: toInt(row[9]),
    };

    if (!record.year) continue;
    sourceYears.add(record.year);
    processed.push(record);
  }

  const years = [...sourceYears].sort((left, right) => left - right);
  const yearKeys = ['all', ...years.map(String)];
  const latestByYear = {};
  const compactRecords = [];
  const normalizedRoadClassLookup = {
    0: ROAD_CLASS_LABELS[0],
  };

  for (const [roadClassId, label] of Object.entries(roadClassLookup)) {
    normalizedRoadClassLookup[roadClassId] = translateRoadClass(toInt(roadClassId), label);
  }

  const summaryByYear = Object.fromEntries(yearKeys.map(key => [key, createStatsBucket()]));
  const monthlyByYear = Object.fromEntries(yearKeys.map(key => [key, Array.from({ length: 12 }, () => 0)]));
  const hourlyByYear = Object.fromEntries(yearKeys.map(key => [key, Array.from({ length: 24 }, () => 0)]));
  const roadClassesByYear = Object.fromEntries(yearKeys.map(key => [key, new Map()]));
  const heatmapByYear = Object.fromEntries(yearKeys.map(key => [key, new Map()]));

  let mappableRecords = 0;

  for (const record of processed) {
    const scopedKeys = ['all', String(record.year)];
    const latestForYear = latestByYear[record.year];
    if (
      !latestForYear ||
      record.month > latestForYear.month ||
      (record.month === latestForYear.month && record.day > latestForYear.day)
    ) {
      latestByYear[record.year] = {
        month: record.month,
        day: record.day,
      };
    }

    compactRecords.push([
      Math.round(record.lat * 10000),
      Math.round(record.lng * 10000),
      record.isMajor ? 1 : 0,
      record.year,
      record.month,
      record.day,
      record.hour,
      record.roadClassId,
      record.died,
      record.injured,
    ]);

    for (const key of scopedKeys) {
      addToStats(summaryByYear[key], record);

      const month = monthIndex(record.month);
      if (month !== null) {
        monthlyByYear[key][month] += 1;
      }

      const hour = hourIndex(record.hour);
      if (hour !== null) {
        hourlyByYear[key][hour] += 1;
      }

      const roadClassLabel = translateRoadClass(
        record.roadClassId,
        roadClassLookup[String(record.roadClassId)],
      );
      const roadClassMap = roadClassesByYear[key];
      roadClassMap.set(roadClassLabel, (roadClassMap.get(roadClassLabel) || 0) + 1);
    }

    if (!isMappableRecord(record, outlineBounds)) {
      continue;
    }

    mappableRecords += 1;
    const x = Math.max(
      0,
      Math.min(
        GRID.cols - 1,
        Math.floor(((record.lng - outlineBounds.minLng) / Math.max(lngRange, 0.000001)) * GRID.cols),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        GRID.rows - 1,
        Math.floor(((outlineBounds.maxLat - record.lat) / Math.max(latRange, 0.000001)) * GRID.rows),
      ),
    );

    const weight = reactionWeight(record);

    for (const key of scopedKeys) {
      const cell = ensureGridBucket(heatmapByYear[key], x, y);
      cell.total += 1;
      cell.major += record.isMajor ? 1 : 0;
      cell.died += record.died;
      cell.injured += record.injured;
      cell.weight += weight;
    }
  }

  const serialisedHeatmaps = {};
  const serialisedRoadClasses = {};
  const serialisedHotspots = {};

  for (const key of yearKeys) {
    const cells = [...heatmapByYear[key].values()]
      .map(cell => [
        cell.x,
        cell.y,
        cell.total,
        cell.major,
        cell.died,
        cell.injured,
        Number(cell.weight.toFixed(2)),
      ])
      .sort((left, right) => left[6] - right[6]);

    const maxCount = cells.reduce((maximum, cell) => Math.max(maximum, cell[2]), 0);
    const maxWeight = cells.reduce((maximum, cell) => Math.max(maximum, cell[6]), 0);

    serialisedHeatmaps[key] = {
      maxCount,
      maxWeight: Number(maxWeight.toFixed(2)),
      cells,
    };

    serialisedRoadClasses[key] = [...roadClassesByYear[key].entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 8);

    serialisedHotspots[key] = [...heatmapByYear[key].values()]
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 6)
      .map(cell => {
        const lat = outlineBounds.maxLat - (((cell.y + 0.5) / GRID.rows) * latRange);
        const lng = outlineBounds.minLng + (((cell.x + 0.5) / GRID.cols) * lngRange);
        return {
          label: findNearestCity(lat, lng),
          lat: Number(lat.toFixed(4)),
          lng: Number(lng.toFixed(4)),
          total: cell.total,
          major: cell.major,
          died: cell.died,
          injured: cell.injured,
          weight: Number(cell.weight.toFixed(2)),
        };
      });
  }

  const snapshot = {
    meta: {
      sourceUrl: SOURCE_URL,
      sourceGeneratedAt: rawJson.meta?.generatedAt || null,
      snapshotGeneratedAt: new Date().toISOString(),
      years,
      latestByYear,
      sourceRecordCount: processed.length,
      mappableRecordCount: mappableRecords,
      grid: {
        cols: GRID.cols,
        rows: GRID.rows,
        bounds: {
          minLat: Number(outlineBounds.minLat.toFixed(6)),
          maxLat: Number(outlineBounds.maxLat.toFixed(6)),
          minLng: Number(outlineBounds.minLng.toFixed(6)),
          maxLng: Number(outlineBounds.maxLng.toFixed(6)),
        },
      },
    },
    lookups: {
      roadClasses: normalizedRoadClassLookup,
    },
    summaryByYear: Object.fromEntries(
      yearKeys.map(key => [key, finalizeStats(summaryByYear[key])]),
    ),
    monthlyByYear,
    hourlyByYear,
    roadClassesByYear: serialisedRoadClasses,
    heatmapByYear: serialisedHeatmaps,
    hotspotsByYear: serialisedHotspots,
    records: compactRecords,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(snapshot)}\n`, 'utf8');

  console.log(JSON.stringify({
    years: snapshot.meta.years,
    sourceRecordCount: snapshot.meta.sourceRecordCount,
    mappableRecordCount: snapshot.meta.mappableRecordCount,
    updatedAt: snapshot.meta.snapshotGeneratedAt,
    outputPath: path.relative(repoRoot, outputPath),
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
