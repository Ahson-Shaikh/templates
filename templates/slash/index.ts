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
          port: 5231,
        },
      ],
      mounts: [
        {
          type: "volume",
          name: "data",
          mountPath: "/var/opt/slash",
        },
      ],
    },
  });

  return { services };
}
