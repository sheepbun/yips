#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const docsDir = path.join(ROOT, 'docs');
const sourcePath = path.join(docsDir, 'progress-log.md');
const entriesRoot = path.join(docsDir, 'progress-log');
const TZ = 'America/Denver';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseHeading(line) {
  const match = line.match(/^##\s+(.+?)\s+[—-]\s+Exchange\s+(\d+)\s*$/u);
  if (!match) {
    return null;
  }

  const stamp = match[1].trim();
  const originalExchange = Number(match[2]);

  const timed = stamp.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})\s+UTC$/);
  if (timed) {
    const [, y, m, d, hh, mm] = timed;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0));
    return {
      originalHeading: line,
      originalExchange,
      sourceStamp: stamp,
      hasExplicitTime: true,
      utcDate: date,
      sourceDate: `${y}-${m}-${d}`,
    };
  }

  const dateOnly = stamp.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return {
      originalHeading: line,
      originalExchange,
      sourceStamp: stamp,
      hasExplicitTime: false,
      sourceDate: `${y}-${m}-${d}`,
      year: Number(y),
      month: Number(m),
      day: Number(d),
    };
  }

  return null;
}

function formatInDenver(utcDate) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });

  const parts = dtf.formatToParts(utcDate);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    zone: get('timeZoneName') || 'MST',
  };
}

function zoneForDateOnly(year, month, day) {
  // Probe at UTC noon; this remains the same local calendar day for America/Denver.
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    timeZoneName: 'short',
  });
  const parts = dtf.formatToParts(probe);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? 'MST';
}

function buildHeading(meta, newExchange) {
  if (meta.hasExplicitTime) {
    const local = formatInDenver(meta.utcDate);
    const dateText = `${local.year}-${pad2(local.month)}-${pad2(local.day)}`;
    const timeText = `${pad2(local.hour)}:${pad2(local.minute)}`;
    return {
      heading: `## ${dateText} ${timeText} ${local.zone} — Exchange ${newExchange}`,
      folder: `${local.year}/${pad2(local.month)}/${pad2(local.day)}`,
      hhmm: `${pad2(local.hour)}${pad2(local.minute)}`,
      dateKey: `${local.year}-${pad2(local.month)}-${pad2(local.day)}`,
      localDateText: dateText,
    };
  }

  const zone = zoneForDateOnly(meta.year, meta.month, meta.day);
  const dateText = `${meta.year}-${pad2(meta.month)}-${pad2(meta.day)}`;
  return {
    heading: `## ${dateText} 00:00 ${zone} — Exchange ${newExchange}`,
    folder: `${meta.year}/${pad2(meta.month)}/${pad2(meta.day)}`,
    hhmm: '0000',
    dateKey: dateText,
    localDateText: dateText,
  };
}

function normalizeBody(rawLines) {
  let body = rawLines.join('\n');
  body = body.replace(/^\n+/, '');
  body = body.replace(/\s+$/, '');
  return body;
}

async function main() {
  const src = await fs.readFile(sourcePath, 'utf8');
  const lines = src.split(/\r?\n/);

  const headingIndices = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      headingIndices.push(i);
    }
  }

  const entries = [];
  for (let i = 0; i < headingIndices.length; i += 1) {
    const start = headingIndices[i];
    const end = i + 1 < headingIndices.length ? headingIndices[i + 1] : lines.length;
    const heading = lines[start];
    const parsed = parseHeading(heading);
    if (!parsed) {
      continue;
    }

    const bodyLines = lines.slice(start + 1, end);
    entries.push({
      sourceIndex: entries.length + 1,
      startLine: start + 1,
      parsed,
      body: normalizeBody(bodyLines),
    });
  }

  if (entries.length === 0) {
    throw new Error('No progress log entries parsed from docs/progress-log.md');
  }

  await fs.rm(entriesRoot, { recursive: true, force: true });
  await fs.mkdir(entriesRoot, { recursive: true });

  const dateGroups = new Map();
  const renumberMap = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const newExchange = i + 1;
    const headingOut = buildHeading(entry.parsed, newExchange);

    const dayDir = path.join(entriesRoot, ...headingOut.folder.split('/'));
    await fs.mkdir(dayDir, { recursive: true });

    const baseName = `${headingOut.hhmm}-exchange-${newExchange}`;
    let filename = `${baseName}.md`;
    let filePath = path.join(dayDir, filename);
    let disambiguator = 2;

    // Keep deterministic behavior if any edge-case collision remains.
    // eslint-disable-next-line no-await-in-loop
    while (true) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.access(filePath);
        filename = `${baseName}-${disambiguator}.md`;
        filePath = path.join(dayDir, filename);
        disambiguator += 1;
      } catch {
        break;
      }
    }

    const relativePath = `./progress-log/${headingOut.folder}/${filename}`;
    const fileText = `${headingOut.heading}\n\n${entry.body}\n`;
    await fs.writeFile(filePath, fileText, 'utf8');

    if (!dateGroups.has(headingOut.dateKey)) {
      dateGroups.set(headingOut.dateKey, []);
    }
    dateGroups.get(headingOut.dateKey).push({
      exchange: newExchange,
      heading: headingOut.heading,
      relativePath,
      sourceIndex: entry.sourceIndex,
    });

    renumberMap.push({
      sourceLine: entry.startLine,
      oldExchange: entry.parsed.originalExchange,
      newExchange,
      oldStamp: entry.parsed.sourceStamp,
      newHeading: headingOut.heading,
      relativePath,
    });
  }

  const sortedDatesDesc = [...dateGroups.keys()].sort((a, b) => (a < b ? 1 : -1));
  const totalEntries = renumberMap.length;

  const indexLines = [
    '# Progress Log',
    '',
    'Rolling implementation handoff between exchanges, stored as one file per entry.',
    '',
    `- Timezone: \`${TZ}\` (MST/MDT as applicable).`,
    '- Numbering: global `Exchange N` sequence by original monolithic source order.',
    '- Location: `docs/progress-log/YYYY/MM/DD/HHMM-exchange-N.md`.',
    '',
    '## How To Read',
    '',
    '- Start with the latest date section below.',
    '- Open the highest-numbered exchange on that date for the newest entry.',
    '',
    '## How To Append A New Entry',
    '',
    '- Create a new file in today\'s local date folder (`docs/progress-log/YYYY/MM/DD/`).',
    '- Use filename format `HHMM-exchange-N.md` (24h local time).',
    '- Use heading format `## YYYY-MM-DD HH:MM MST|MDT — Exchange N`.',
    '',
    '## Entries By Date',
    '',
  ];

  for (const dateKey of sortedDatesDesc) {
    indexLines.push(`### ${dateKey}`);
    indexLines.push('');

    const dayEntries = dateGroups.get(dateKey).sort((a, b) => a.exchange - b.exchange);
    for (const item of dayEntries) {
      indexLines.push(`- [Exchange ${item.exchange}](${item.relativePath})`);
    }
    indexLines.push('');
  }

  indexLines.push('## Migration Note');
  indexLines.push('');
  indexLines.push(
    `This index and directory tree were generated by \`scripts/migrate-progress-log.mjs\` from the prior monolithic log.`
  );
  indexLines.push('Historical headings were normalized to local timezone and exchange numbers were globally renumbered.');
  indexLines.push('');
  indexLines.push('## Stats');
  indexLines.push('');
  indexLines.push(`- Total entries: ${totalEntries}`);
  indexLines.push(`- Total dates: ${sortedDatesDesc.length}`);
  indexLines.push('');

  await fs.writeFile(sourcePath, `${indexLines.join('\n')}\n`, 'utf8');

  const reportPath = path.join(entriesRoot, 'migration-report.md');
  const reportLines = [
    '# Progress Log Migration Report',
    '',
    `- Source: \`docs/progress-log.md\` (pre-migration monolith)`,
    `- Generated: ${new Date().toISOString()}`,
    `- Timezone conversion: \`${TZ}\``,
    `- Entries migrated: ${totalEntries}`,
    '',
    '## Renumber Map',
    '',
    '| Source Line | Old Exchange | New Exchange | Old Stamp | New Heading | Path |',
    '|---:|---:|---:|---|---|---|',
  ];

  for (const row of renumberMap) {
    reportLines.push(
      `| ${row.sourceLine} | ${row.oldExchange} | ${row.newExchange} | ${row.oldStamp} | ${row.newHeading.replace(/\|/g, '\\|')} | ${row.relativePath} |`
    );
  }

  await fs.writeFile(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  console.log(`Migrated ${totalEntries} entries into ${entriesRoot}`);
  console.log(`Wrote index: ${sourcePath}`);
  console.log(`Wrote report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
