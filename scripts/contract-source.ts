import { z } from 'zod';

/**
 * De dónde sale la copia del contrato: siempre de una carpeta publicada e inmutable del POS, nunca
 * de main de offline-pos. Es tooling (lo corre una persona a mano), así que lanza en vez de
 * devolver un Result.
 */
export const PUBLISHED_POS_ORIGIN = 'https://offline-pos.pages.dev';

const SEMVER = /^\d+\.\d+\.\d+$/;
const semver = z.string().regex(SEMVER);

const publishedVersionSchema = z.object({
  version: semver,
  contract: semver,
  minBackendContract: semver,
});

export type PublishedVersion = z.infer<typeof publishedVersionSchema>;

export type ContractJson = {
  posVersion: string;
  contract: string;
  minBackendContract: string;
  source: string;
};

export function contractBaseUrl(posVersion: string): string {
  if (!SEMVER.test(posVersion)) {
    throw new Error(`La versión del POS tiene que ser x.y.z (sin "v"): ${JSON.stringify(posVersion)}`);
  }
  return `${PUBLISHED_POS_ORIGIN}/${posVersion}/`;
}

export function parseVersionJson(raw: unknown, expectedPosVersion: string): PublishedVersion {
  const parsed = publishedVersionSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`version.json publicado inválido: ${issues}`);
  }
  if (parsed.data.version !== expectedPosVersion) {
    throw new Error(`version.json dice ${parsed.data.version} pero se pidió ${expectedPosVersion}`);
  }
  return parsed.data;
}

/** La `version` del bloque `info:` de primer nivel, sin sumar un parser de YAML. */
export function openApiInfoVersion(yaml: string): string | undefined {
  const lines = yaml.split(/\r?\n/);
  const start = lines.indexOf('info:');
  if (start === -1) return undefined;
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !line.startsWith(' ')) return undefined;
    const match = /^ {2}version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

export function contractJson(v: PublishedVersion): ContractJson {
  return {
    posVersion: v.version,
    contract: v.contract,
    minBackendContract: v.minBackendContract,
    source: contractBaseUrl(v.version),
  };
}
