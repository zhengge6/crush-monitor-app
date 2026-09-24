export const PROVIDERS = {
  typesafe: {
    name: "TypeSafe",
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-1.13.0",
    keyEnv: "TYPESAFE_API_KEY",
    keyUrl: "https://console.typesafe.ai/",
  },
  vercel: {
    name: "Vercel AI Gateway",
    endpoint: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
    model: "typesafe-ai/jev",
    keyEnv: "AI_GATEWAY_API_KEY",
    keyUrl: "https://vercel.com/d?to=/%5Bteam%5D/~/ai-gateway/api-keys",
  },
  openrouter: {
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/alpha/decisions",
    model: "typesafe/jev-1.13",
    keyEnv: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/settings/keys",
  },
} as const;
export type Provider = keyof typeof PROVIDERS;
export type ProviderConfig = (typeof PROVIDERS)[Provider] & {
  provider: Provider;
  apiKey: string;
};
export type ProviderOverrides = {
  provider?: string | null;
  apiKey?: string | null;
};

export class ConfigurationError extends Error {
  readonly status = 503;
}

function normalizeProvider(
  value: string | null | undefined,
  fallback = "typesafe",
): Provider {
  const selected = (value || fallback).trim().toLowerCase();
  if (!Object.hasOwn(PROVIDERS, selected))
    throw new ConfigurationError(
      "平台只支持 typesafe、vercel、openrouter。请在设置中选择。 / Unsupported provider.",
    );
  return selected as Provider;
}

function normalizeApiKey(apiKey: string, provider: Provider, name: string) {
  const key = apiKey.trim();
  if (!key || /^(your[_-].*|replace[_-].*|xxx+|<.*>)$/i.test(key))
    throw new ConfigurationError(
      `${name} 未配置 API Key，请在设置中填写。 / API key required.`,
    );
  if (/[\s\x00-\x1f\x7f"'`]/.test(key) || key.includes("="))
    throw new ConfigurationError(
      "请只粘贴 Key 本身，不要带变量名、引号或 Bearer。 / Paste the key only.",
    );
  if (key.startsWith("sk-or-") && provider !== "openrouter")
    throw new ConfigurationError(
      "这看起来是 OpenRouter Key，请选择 openrouter。 / Select OpenRouter for this key.",
    );
  return key;
}

export function getProviderConfig(
  env: Record<string, string | undefined> = process.env,
  overrides?: ProviderOverrides,
): ProviderConfig {
  const provider = normalizeProvider(
    overrides?.provider ?? env.JEV_PROVIDER,
    "typesafe",
  );
  const preset = PROVIDERS[provider];
  const raw =
    (overrides?.apiKey != null && String(overrides.apiKey).length
      ? String(overrides.apiKey)
      : "") ||
    env.JEV_API_KEY ||
    env[preset.keyEnv] ||
    "";
  const apiKey = normalizeApiKey(raw, provider, preset.name);
  return { ...preset, provider, apiKey };
}

/** Resolve config preferring per-request client key, then server env. */
export function resolveRequestProvider(
  overrides?: ProviderOverrides,
  env: Record<string, string | undefined> = process.env,
): ProviderConfig {
  const hasClientKey = !!(overrides?.apiKey && String(overrides.apiKey).trim());
  if (hasClientKey) return getProviderConfig(env, overrides);
  return getProviderConfig(env, {
    provider: overrides?.provider ?? env.JEV_PROVIDER,
  });
}

export function providerStatus(
  env: Record<string, string | undefined> = process.env,
) {
  const catalog = (
    Object.entries(PROVIDERS) as [Provider, (typeof PROVIDERS)[Provider]][]
  ).map(([id, preset]) => ({
    id,
    name: preset.name,
    model: preset.model,
    keyUrl: preset.keyUrl,
  }));
  try {
    const config = getProviderConfig(env);
    return {
      configured: true,
      userKeysSupported: true,
      serverKeyConfigured: true,
      provider: config.provider,
      model: config.model,
      defaultProvider: "typesafe" as const,
      providers: catalog,
    };
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    const provider = (() => {
      try {
        return normalizeProvider(env.JEV_PROVIDER, "typesafe");
      } catch {
        return "typesafe" as Provider;
      }
    })();
    return {
      configured: false,
      userKeysSupported: true,
      serverKeyConfigured: false,
      provider,
      model: PROVIDERS[provider].model,
      defaultProvider: "typesafe" as const,
      providers: catalog,
      error: error.message,
    };
  }
}
