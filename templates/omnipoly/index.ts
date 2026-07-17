import { Output, randomString, Services } from "~templates-utils";
import { Input } from "./meta";

export function generate(input: Input): Output {
  const services: Services = [];
  const authPassword = randomString(20);

  const env = [
    `THEME=${input.theme}`,
    `DEFAULT_TAB=${input.defaultTab}`,
    `DEFAULT_TARGET_LANGUAGE=${input.defaultTargetLanguage}`,
  ];

  if (input.libreTranslateUrl) {
    env.push(`LIBRETRANSLATE=${input.libreTranslateUrl}`);
  }
  if (input.libreTranslateApiKey) {
    env.push(`LIBRETRANSLATE_API_KEY=${input.libreTranslateApiKey}`);
  }
  if (input.languageToolUrl) {
    env.push(`LANGUAGE_TOOL=${input.languageToolUrl}`);
  }
  if (input.ollamaUrl) {
    env.push(`OLLAMA=${input.ollamaUrl}`);
  }
  if (input.ollamaModel) {
    env.push(`OLLAMA_MODEL=${input.ollamaModel}`);
  }

  services.push({
    type: "app",
    data: {
      serviceName: input.appServiceName,
      source: {
        type: "image",
        image: input.appServiceImage,
      },
      env: env.join("\n"),
      domains: [
        {
          host: "$(EASYPANEL_DOMAIN)",
          port: 80,
        },
      ],
      basicAuth: [{ username: "admin", password: authPassword }],
    },
  });

  return { services };
}
