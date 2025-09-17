import { Output, Services } from "~templates-utils";
import { Input } from "./meta";

export function generate(input: Input): Output {
  const services: Services = [];
  const api_key = randomString(32);
  const admin_pass = randomString(32);

  services.push({
    type: "app",
    data: {
      serviceName: input.appServiceName,
      env: [
        `WAHA_API_KEY=${api_key}`,
        `WHATSAPP_API_HOSTNAME=${EASYPANEL_DOMAIN}`
        `WAHA_BASE_URL=https://${EASYPANEL_DOMAIN}`,
        `WAHA_DASHBOARD_USERNAME=admin`,
        `WAHA_DASHBOARD_PASSWORD=${admin_pass}`,
        `WAHA_DEBUG_MODE=false`,
        `WHATSAPP_DEFAULT_ENGINE=GOWS`,
        `WAHA_RESTART_ALL_SESSIONS=True`,
      ].join("\n"),
      source: {
        type: "image",
        image: input.appServiceImage,
      },
      domains: [
        {
          host: "$(EASYPANEL_DOMAIN)",
          port: 3000,
        },
      ],
      mounts: [
        {
          type: "volume",
          name: "sessions",
          mountPath: "/app/.sessions",
        },
      ],
    },
  });

  return { services };
}
