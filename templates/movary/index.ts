import { Output, Services } from "~templates-utils";
import { Input } from "./meta";

export function generate(input: Input): Output {
  const services: Services = [];

  services.push({
    type: "app",
    data: {
      serviceName: input.appServiceName,
      source: {
        type: "image",
        image: input.appServiceImage,
      },
      domains: [
        {
          host: "$(EASYPANEL_DOMAIN)",
          port: 8080,
        },
      ],
      mounts: [
        {
          type: "volume",
          name: "storage",
          mountPath: "/app/storage",
        },
      ],
      env: [`TMDB_API_KEY=${input.tmdbApiKey}`, `DATABASE_MODE=sqlite`].join(
        "\n"
      ),
    },
  });

  return { services };
}
