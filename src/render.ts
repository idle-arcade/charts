import * as echarts from 'echarts';
import sharp from 'sharp';
import { effortInsights, weeklyCompletions } from './insights.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config, Dimension, Result, Snapshot } from './types.ts';

const color = (dimension: Dimension, category: string) =>
  dimension.colors?.[category] ??
  `hsl(${[...`${dimension.key}:${category}`].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 360}, 65%, 48%)`;
const hours = (value: number) =>
  new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
const xml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const display = (text: string, dimension: Dimension) =>
  dimension.source === 'assignee'
    ? text
    : text.replaceAll('-', ' ').replace(/^./, (char) => char.toUpperCase());
const wrap = (value: string) =>
  value.replace(/(.{1,30})(\s+|$)/g, '$1\n').trim();

export function renderSvg(
  option: echarts.EChartsOption,
  description: string,
): string {
  const chart = echarts.init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    width: 1280,
    height: 720,
  });
  try {
    chart.setOption({
      backgroundColor: '#f8fafc',
      animation: false,
      textStyle: {
        fontFamily: 'DejaVu Sans, Arial, sans-serif',
        color: '#334155',
      },
      ...option,
    });
    const identifiers = new Map<string, string>();
    const svg = chart
      .renderToSVGString()
      .replace(/zr\d+(?:-[\w-]+)?/g, (value) => {
        if (!identifiers.has(value))
          identifiers.set(value, `chart-id-${identifiers.size}`);
        return identifiers.get(value)!;
      });
    return svg.replace(
      '<svg ',
      `<svg role="img" aria-label="${xml(description)}" `,
    );
  } finally {
    chart.dispose();
  }
}

export async function renderCharts(
  directory: string,
  config: Config,
  snapshot: Snapshot,
  result: Result,
  scope: string,
  sprintId?: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const subtitle = `${config.title}\n${scope} · snapshot ${snapshot.fetchedAt.slice(0, 10)} · ${result.included.length} included issues`;
  const write = async (
    name: string,
    option: echarts.EChartsOption,
    description: string,
  ) => {
    const svg = renderSvg(option, description);
    await writeFile(join(directory, `${name}.svg`), svg);
    await sharp(Buffer.from(svg), { density: 144 })
      .png()
      .toFile(join(directory, `${name}.png`));
  };
  for (const dimension of config.dimensions) {
    const rows = result.aggregates[dimension.key];
    await write(
      dimension.key,
      {
        title: {
          text: dimension.title,
          subtext: subtitle,
          left: 38,
          top: 28,
          textStyle: { fontSize: 28, color: '#0f172a', fontWeight: 700 },
          subtextStyle: { fontSize: 13, lineHeight: 22, color: '#64748b' },
        },
        graphic: [
          {
            type: 'text',
            right: 40,
            top: 34,
            style: {
              text: `${hours(result.totalHours)} h`,
              fontSize: 28,
              fontWeight: 700,
              fontFamily: 'DejaVu Sans',
              fill: '#4f46e5',
            },
          },
          ...(!rows.length
            ? [
                {
                  type: 'text' as const,
                  left: 'center',
                  top: 'middle',
                  style: {
                    text: 'No valid recorded effort in this scope',
                    fontSize: 20,
                    fill: '#64748b',
                  },
                },
              ]
            : []),
        ],
        grid: { left: 300, right: 175, top: 155, bottom: 65 },
        xAxis: {
          type: 'value',
          name: 'Recorded effort (hours)',
          nameLocation: 'middle',
          nameGap: 34,
          min: 0,
          splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } },
        },
        yAxis: {
          type: 'category',
          inverse: true,
          data: rows.map((row) => wrap(display(row.category, dimension))),
          axisTick: { show: false },
          axisLine: { show: false },
          axisLabel: { fontSize: 14, lineHeight: 19, margin: 18 },
        },
        series: [
          {
            type: 'bar',
            barMaxWidth: 27,
            data: rows.map((row) => ({
              value: row.hours,
              itemStyle: {
                color: color(dimension, row.category),
                borderRadius: [0, 6, 6, 0],
              },
            })),
            label: {
              show: true,
              position: 'right',
              distance: 12,
              fontSize: 13,
              color: '#334155',
              formatter: (params) => {
                const row = rows[params.dataIndex];
                return `${hours(row.hours)} h   ·   ${row.percentage.toFixed(1)}%`;
              },
            },
          },
        ],
      },
      `${dimension.title}: ${hours(result.totalHours)} included hours. ${scope}. ${subtitle}`,
    );

    const sprints = new Map(
      result.included.map((entry) => [
        entry.sprint?.id ?? 'unassigned',
        entry.sprint,
      ]),
    );
    const sprintIds = [...sprints.keys()].sort(
      (a, b) =>
        (sprints.get(a)?.startDate ?? '9999').localeCompare(
          sprints.get(b)?.startDate ?? '9999',
        ) || a.localeCompare(b),
    );
    await write(
      `${dimension.key}-by-sprint`,
      {
        title: {
          text: `${dimension.title} · by sprint`,
          subtext: `${subtitle}\nAssigned sprint attribution; issue totals do not establish dated work.`,
          left: 38,
          top: 28,
          textStyle: { fontSize: 25, color: '#0f172a' },
          subtextStyle: { fontSize: 12, lineHeight: 21 },
        },
        legend: {
          bottom: 24,
          left: 60,
          width: 1080,
          itemWidth: 18,
          itemHeight: 12,
          itemGap: 28,
          textStyle: { fontSize: 11, lineHeight: 20 },
        },
        grid: {
          left: 85,
          right: 45,
          top: 170,
          bottom: Math.max(135, Math.ceil(rows.length / 5) * 35 + 80),
        },
        xAxis: {
          type: 'category',
          data: sprintIds.map((id) => sprints.get(id)?.title ?? 'No sprint'),
          axisLabel: { interval: 0, rotate: sprintIds.length > 8 ? 30 : 0 },
        },
        yAxis: {
          type: 'value',
          name: 'Hours',
          splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } },
        },
        series: rows.map((row) => ({
          name: display(row.category, dimension),
          type: 'bar',
          stack: 'hours',
          barMaxWidth: 65,
          itemStyle: { color: color(dimension, row.category) },
          data: sprintIds.map((id) =>
            result.included
              .filter(
                (entry) =>
                  (entry.sprint?.id ?? 'unassigned') === id &&
                  entry.categories[dimension.key] === row.category,
              )
              .reduce((sum, entry) => sum + entry.hours, 0),
          ),
        })),
      },
      `${dimension.title}, hours by assigned sprint. ${scope}.`,
    );
  }
  const insights = effortInsights(result, config);
  if (
    config.dimensions.some((d) => d.key === 'discipline') &&
    config.dimensions.some((d) => d.key === 'phase')
  ) {
    const max = Math.max(1, ...insights.heatmap.map((cell) => cell.hours));
    await write(
      'discipline-phase',
      {
        title: {
          text: 'Discipline × phase',
          subtext: subtitle,
          left: 38,
          top: 28,
          textStyle: { fontSize: 28, color: '#0f172a' },
          subtextStyle: { fontSize: 13, lineHeight: 22 },
        },
        grid: { left: 260, right: 75, top: 160, bottom: 110 },
        xAxis: {
          type: 'category',
          data: insights.phases.map((name) =>
            name.replace(/^./, (x) => x.toUpperCase()),
          ),
          splitArea: { show: true },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { fontSize: 14 },
        },
        yAxis: {
          type: 'category',
          inverse: true,
          data: insights.disciplines.map((name) =>
            name.replace(/^./, (x) => x.toUpperCase()),
          ),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { fontSize: 14, margin: 18 },
        },
        visualMap: {
          min: 0,
          max,
          calculable: false,
          orient: 'horizontal',
          left: 'center',
          bottom: 22,
          text: ['More hours', '0 h'],
          inRange: { color: ['#eef2ff', '#a5b4fc', '#6366f1', '#3730a3'] },
        },
        series: [
          {
            type: 'heatmap',
            data: insights.heatmap.map((cell) => ({
              value: [
                insights.phases.indexOf(cell.phase),
                insights.disciplines.indexOf(cell.discipline),
                cell.hours,
              ],
              label: { color: cell.hours > max * 0.55 ? '#ffffff' : '#334155' },
            })),
            label: {
              show: true,
              fontSize: 15,
              formatter: (params) =>
                `${hours((params.value as number[])[2])} h`,
            },
            itemStyle: {
              borderWidth: 4,
              borderColor: '#f8fafc',
              borderRadius: 5,
            },
          },
        ],
      },
      'Recorded effort in hours by discipline and phase. Each included hour appears once.',
    );
  }
  if (
    ['person', 'discipline', 'usecase'].every((key) =>
      config.dimensions.some((d) => d.key === key),
    )
  ) {
    await write(
      'effort-flow',
      {
        title: {
          text: 'Where the effort flows',
          subtext: `${subtitle}\nPerson → discipline → use case · every stage represents the same ${hours(result.totalHours)} hours`,
          left: 38,
          top: 28,
          textStyle: { fontSize: 28, color: '#0f172a' },
          subtextStyle: { fontSize: 13, lineHeight: 22 },
        },
        series: [
          {
            type: 'sankey',
            left: 165,
            right: 235,
            top: 180,
            bottom: 55,
            nodeWidth: 16,
            nodeGap: 34,
            draggable: false,
            nodeAlign: 'justify',
            layoutIterations: 32,
            data: insights.sankey.nodes
              .filter((node) => node.hours > 0)
              .map((node) => {
                const dimension = config.dimensions.find(
                  (d) => d.key === node.stage,
                )!;
                return {
                  name: node.id,
                  depth: node.depth,
                  value: node.hours,
                  itemStyle: { color: color(dimension, node.category) },
                  label: {
                    position:
                      node.depth === 0 ? ('left' as const) : ('right' as const),
                    formatter: `${wrap(display(node.category, dimension))}\n${hours(node.hours)} h`,
                    fontSize: 12,
                    lineHeight: 18,
                  },
                };
              }),
            links: insights.sankey.links,
            lineStyle: { color: 'source', opacity: 0.26, curveness: 0.5 },
          },
        ],
      },
      'Recorded hours flowing from assigned person to discipline to use case. Stages must not be added together.',
    );
  }
  const completions = weeklyCompletions(snapshot, sprintId);
  await write(
    'completed-by-week',
    {
      title: {
        text: 'Completed leaf issues · by week',
        subtext: `${scope} · current board · latest GitHub completion date\nIncludes completed leaf issues regardless of recorded hours; current week may be partial.`,
        left: 38,
        top: 28,
        textStyle: { fontSize: 25, color: '#0f172a' },
        subtextStyle: { fontSize: 13, lineHeight: 22 },
      },
      grid: { left: 85, right: 55, top: 165, bottom: 80 },
      xAxis: {
        type: 'category',
        data: completions.weeks.map((row, index) =>
          index === completions.weeks.length - 1 ? 'Current Week' : row.label,
        ),
        axisLabel: {
          interval: 0,
          rotate: completions.weeks.length > 8 ? 30 : 0,
        },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        name: 'Leaf issues',
        splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } },
      },
      graphic: !completions.weeks.length
        ? [
            {
              type: 'text',
              left: 'center',
              top: 'middle',
              style: {
                text: 'No completed leaf issues with GitHub completion dates',
                fontSize: 18,
                fill: '#64748b',
              },
            },
          ]
        : [],
      series: [
        {
          type: 'bar',
          barMaxWidth: 70,
          data: completions.weeks.map((row) => row.count),
          itemStyle: { color: '#6366f1', borderRadius: [6, 6, 0, 0] },
          label: { show: true, position: 'top', fontSize: 14 },
        },
      ],
    },
    completions.definition,
  );
}
