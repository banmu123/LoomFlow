'use client';

import { useT } from '@/lib/i18n';
import { DIMENSIONS, DIMENSION_META } from '@/lib/growth/ability-types';
import type { AbilityScores, AbilityDimension } from '@/lib/growth/ability-types';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';

export function AbilityRadar({
  scores,
  size = 'full',
  onDimensionClick,
}: {
  scores: AbilityScores;
  size?: 'mini' | 'full';
  onDimensionClick?: (dim: AbilityDimension) => void;
}) {
  const t = useT();

  const data = DIMENSIONS.map((dim) => ({
    dimension: dim,
    label: t(DIMENSION_META[dim].labelKey),
    value: scores[dim],
    fullMark: 100,
  }));

  const height = size === 'mini' ? 220 : 360;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="75%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: size === 'mini' ? 11 : 13 }}
            className="cursor-pointer"
            onClick={(entry: { dimension?: string }) => {
              if (entry?.dimension && onDimensionClick) {
                onDimensionClick(entry.dimension as AbilityDimension);
              }
            }}
          />
          <PolarRadiusAxis
            angle={30}
            domain={[0, 100]}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            tickCount={4}
          />
          <Radar
            name="能力值"
            dataKey="value"
            stroke="#6366f1"
            fill="#6366f1"
            fillOpacity={0.25}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
