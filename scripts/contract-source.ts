import { z } from '../src/shared/zod.ts';
import { channelOf } from '../src/shared/contract-version.ts';

/**
 * De dónde sale la copia del contrato (#58): el canal publicado del POS para un major
 * (`https://pos.contax.ar/v4/`), nunca main de offline-pos. El canal no fija una versión del POS:
 * `contract.json` anota cuál había, como procedencia. Es tooling (lo corre una persona a mano), así
 * que lanza en vez de devolver un Result.
 */
export const PUBLISHED_POS_ORIGIN = 'https://pos.contax.ar';

const SEMVER = /^\d+\.\d+\.\d+$/;
const CHANNEL = /^v[1-9]\d*$/;
const semver = z.string().regex(SEMVER);

const publishedVersionSchema = z.object({
  version: semver,
  contract: semver,
  minBackendContract: semver,
});

export type PublishedVersion = z.infer<typeof publishedVersionSchema>;

export type ContractJson = {
  channel: string;
  /** Qué POS había en el canal al bajar la copia: procedencia, ningún código la lee. */
  posVersion: string;
  contract: string;
  minBackendContract: string;
  source: string;
};

export function channelBaseUrl(channel: string): string {
  if (!CHANNEL.test(channel)) {
    throw new Error(`El canal del POS tiene que ser v<major> (por ejemplo v4): ${JSON.stringify(channel)}`);
  }
  return `${PUBLISHED_POS_ORIGIN}/${channel}/`;
}

/** El `version.json` del canal: válido y con un contrato del major del canal. */
export function parseVersionJson(raw: unknown, channel: string): PublishedVersion {
  const parsed = publishedVersionSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`version.json publicado inválido: ${issues}`);
  }
  if (channelOf(parsed.data.contract) !== channel) {
    throw new Error(`El version.json de ${channel} dice contrato ${parsed.data.contract}`);
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

export function contractJson(channel: string, v: PublishedVersion): ContractJson {
  return {
    channel,
    posVersion: v.version,
    contract: v.contract,
    minBackendContract: v.minBackendContract,
    source: channelBaseUrl(channel),
  };
}
