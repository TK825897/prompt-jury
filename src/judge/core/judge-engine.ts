import type { JudgeProvider } from "./judge-types";
import { JudgeEngineError } from "./judge-types";

export class JudgeEngine {
  private readonly providers = new Map<string, JudgeProvider>();

  constructor(providers: Iterable<JudgeProvider> = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: JudgeProvider): void {
    if (this.providers.has(provider.id)) {
      throw new JudgeEngineError(
        "INVALID_INPUT",
        `Judge provider '${provider.id}' is already registered.`,
      );
    }
    this.providers.set(provider.id, provider);
  }

  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  get(providerId: string): JudgeProvider | undefined {
    return this.providers.get(providerId);
  }

  getRequired(providerId: string): JudgeProvider {
    const provider = this.get(providerId);
    if (!provider)
      throw new JudgeEngineError(
        "PROVIDER_NOT_FOUND",
        `Judge provider '${providerId}' is not registered.`,
      );
    return provider;
  }

  list(): JudgeProvider[] {
    return [...this.providers.values()];
  }

  async listAvailability(): Promise<
    Array<{ provider: JudgeProvider; available: boolean }>
  > {
    return Promise.all(
      this.list().map(async (provider) => {
        try {
          return { provider, available: await provider.checkAvailability() };
        } catch {
          return { provider, available: false };
        }
      }),
    );
  }
}
