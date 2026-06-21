import { onRequest as __api___path___js_onRequest } from "D:\\CODE\\Python\\AIML\\CityFlow\\src\\dashboard\\functions\\api\\[[path]].js"
import { onRequest as __maps___path___js_onRequest } from "D:\\CODE\\Python\\AIML\\CityFlow\\src\\dashboard\\functions\\maps\\[[path]].js"

export const routes = [
    {
      routePath: "/api/:path*",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api___path___js_onRequest],
    },
  {
      routePath: "/maps/:path*",
      mountPath: "/maps",
      method: "",
      middlewares: [],
      modules: [__maps___path___js_onRequest],
    },
  ]