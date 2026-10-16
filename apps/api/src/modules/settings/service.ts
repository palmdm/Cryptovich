import type { PrismaClient } from "@platform/db";
import {
  effectiveParameter,
  isServerParameterKey,
  normaliseParameter,
  parseDomainList,
  SERVER_PARAMETER_KEYS,
  SERVER_PARAMETERS,
  type FederationPolicy,
  type ParameterProblem,
  type ParameterSource,
  type ServerParameterKey,
} from "@platform/shared";
import { AppError } from "../../lib/errors.js";

/**
 * The operator's settings, read by the features they govern.
 *
 * Every one is in `SERVER_PARAMETERS` (`@platform/shared`): a value saved
 * in the admin area ("Редактирование параметров") is stored here in the
 * `ServerSetting` table and wins; until one is saved, the `.env` variable
 * of the same meaning is the value, then the built-in default. So a
 * server whose admin never opens the page keeps what its `.env` says.
 *
 * Reads are cached for a few seconds. These are consulted on request
 * paths (can this account mint a key, does this server federate at all),
 * and a database round trip per check would be pure cost for a value that
 * changes about once a year.
 *
 * The table also holds rows that are *not* settings (the instance actor's
 * keys, the push keypair, release markers); nothing here lists or returns
 * them.
 */

/** The three switches `/admin/settings` has always offered, by the values its page shows. */
export const SERVER_SETTINGS = {
  apiAccessMode: { default: "contribution", values: ["contribution", "free"] },
  federationEnabled: { default: "true", values: ["true", "false"] },
  registrationMode: { default: "invite", values: ["invite", "open"] },
} as const;

export type ServerSettingKey = keyof typeof SERVER_SETTINGS;
export type ServerSettings = Record<ServerSettingKey, string>;

export interface ParameterView {
  key: ServerParameterKey;
  /** Null for a secret: what it is never leaves the server through here. */
  value: string | null;
  /** Whether it has any value at all — the one thing a secret shows. */
  set: boolean;
  source: ParameterSource;
}

const CACHE_TTL_MS = 5_000;

/**
 * Shared by every instance in this process, deliberately.
 *
 * These are read from several modules, each of which constructs its own
 * service; a per-instance cache meant a setting changed through the admin
 * routes stayed stale everywhere else until its own copy expired. With a
 * second API process (or the worker) the TTL is still the bound on how
 * long another process can be behind — five seconds.
 *
 * Only what is *stored* is cached. `.env` and the defaults are resolved on
 * every read, so a test that changes the environment sees it at once.
 */
let cache: { at: number; stored: Map<string, string> } | null = null;

export function parameterRefused(key: string, problem: ParameterProblem | "unknown"): AppError {
  return new AppError(400, `${key}: ${problem === "unknown" ? "there is no such setting" : `not a valid value (${problem})`}.`, "PARAMETER_INVALID");
}

export class SettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async stored(): Promise<Map<string, string>> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.stored;
    const rows = await this.prisma.serverSetting.findMany({ where: { key: { in: SERVER_PARAMETER_KEYS } } });
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    cache = { at: Date.now(), stored };
    return stored;
  }

  /** One setting as it is in force right now. */
  async parameter(key: ServerParameterKey): Promise<string> {
    return effectiveParameter(key, (await this.stored()).get(key), process.env).value;
  }

  /** Every setting for the admin table, secrets reduced to whether they are set. */
  async parameters(): Promise<ParameterView[]> {
    const stored = await this.stored();
    return SERVER_PARAMETER_KEYS.map((key) => {
      const { value, source } = effectiveParameter(key, stored.get(key), process.env);
      const secret = SERVER_PARAMETERS[key].kind === "secret";
      return { key, value: secret ? null : value, set: value !== "", source };
    });
  }

  /** Every setting's value in force, for an export file; secrets only when asked. */
  async exportable(includeSecrets: boolean): Promise<Partial<Record<ServerParameterKey, string>>> {
    const stored = await this.stored();
    const out: Partial<Record<ServerParameterKey, string>> = {};
    for (const key of SERVER_PARAMETER_KEYS) {
      if (SERVER_PARAMETERS[key].kind === "secret" && !includeSecrets) continue;
      out[key] = effectiveParameter(key, stored.get(key), process.env).value;
    }
    return out;
  }

  /**
   * Saves several settings at once — all or none: one value that does not
   * fit refuses the whole change. `null` forgets the saved value, so the
   * setting follows `.env` (or its default) again. Returns what changed.
   */
  async saveParameters(changes: Record<string, unknown>): Promise<ServerParameterKey[]> {
    const writes: { key: ServerParameterKey; value: string | null }[] = [];
    for (const [key, raw] of Object.entries(changes)) {
      if (!isServerParameterKey(key)) throw parameterRefused(key, "unknown");
      if (raw === null) {
        writes.push({ key, value: null });
        continue;
      }
      const checked = normaliseParameter(key, raw);
      if (!checked.ok) throw parameterRefused(key, checked.problem);
      writes.push({ key, value: checked.value });
    }
    await this.prisma.$transaction(
      writes.map(({ key, value }) =>
        value === null
          ? this.prisma.serverSetting.deleteMany({ where: { key } })
          : this.prisma.serverSetting.upsert({ where: { key }, update: { value }, create: { key, value } }),
      ),
    );
    cache = null;
    return writes.map((write) => write.key);
  }

  /** The three switches of `/admin/settings`. */
  async all(): Promise<ServerSettings> {
    return {
      apiAccessMode: await this.parameter("apiAccessMode"),
      federationEnabled: await this.parameter("federationEnabled"),
      registrationMode: await this.parameter("registrationMode"),
    };
  }

  async get<K extends ServerSettingKey>(key: K): Promise<string> {
    return this.parameter(key);
  }

  /** Writes one of the three switches. Unknown keys and values are refused by the caller's schema. */
  async set(key: ServerSettingKey, value: string): Promise<ServerSettings> {
    await this.saveParameters({ [key]: value });
    return this.all();
  }

  async isApiAccessFree(): Promise<boolean> {
    return (await this.parameter("apiAccessMode")) === "free";
  }

  async isFederationEnabled(): Promise<boolean> {
    return (await this.parameter("federationEnabled")) === "true";
  }

  async isRegistrationOpen(): Promise<boolean> {
    return (await this.parameter("registrationMode")) === "open";
  }

  async registrationBotCheck(): Promise<boolean> {
    return (await this.parameter("registrationBotCheck")) === "true";
  }

  /** Zero bits a sign-up's proof of work must start with: 18 is about a second on a phone. */
  async proofOfWorkBits(): Promise<number> {
    return Number(await this.parameter("registrationPowBits"));
  }

  /** The bot as a bridge: needs the bot's token as well as the switch. */
  async telegramBridge(): Promise<boolean> {
    return (await this.parameter("telegramBridge")) === "true" && (await this.parameter("telegramBotToken")) !== "";
  }

  async adminRequiresTwoFactor(): Promise<boolean> {
    return (await this.parameter("adminRequire2fa")) === "true";
  }

  /**
   * Which instances this server federates with. Every follower is a
   * delivery on every future post, so an open instance's outbound traffic
   * grows with the whole network; an operator who wants a bounded bill
   * uses the allowlist. The blocklist always wins, in either mode.
   */
  async federationPolicy(): Promise<FederationPolicy> {
    return {
      mode: (await this.parameter("federationMode")) === "allowlist" ? "allowlist" : "open",
      allowed: parseDomainList(await this.parameter("federationAllowedDomains")),
      blocked: parseDomainList(await this.parameter("federationBlockedDomains")),
    };
  }

  /** The upload limit for this uploader: an administrator has their own. */
  async maxUploadBytes(userId?: string | null): Promise<number> {
    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (user?.role === "ADMIN") return Number(await this.parameter("adminMaxUploadBytes"));
    }
    return Number(await this.parameter("maxUploadBytes"));
  }

  async postMaxChars(): Promise<number> {
    return Number(await this.parameter("postMaxChars"));
  }

  async email(): Promise<{ smtpUrl: string; from: string }> {
    return { smtpUrl: await this.parameter("smtpUrl"), from: await this.parameter("emailFrom") };
  }

  async favicon(): Promise<string> {
    return this.parameter("favicon");
  }

  async telegramBotToken(): Promise<string> {
    return this.parameter("telegramBotToken");
  }
}

/** "5MB" for a refusal message: what the limit is, in the unit people use. */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}
