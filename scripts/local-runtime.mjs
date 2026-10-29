import { resolve } from "node:path";

/** Synthetic modes must never use public or the configured main schema. */
export function isolatedSchema(environment, key, fallback) {
  const schema = environment[key] || fallback;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema) || schema === "public"
      || schema === (environment.DB_SCHEMA || "public")
      || schema === "information_schema" || schema.startsWith("pg_"))
    throw new Error(`${key}: нужна отдельная несистемная схема, отличная от public и основной схемы.`);
  return schema;
}

/** Public training passwords and the rules-only demo are always restricted to loopback. */
export function accountDemoEnvironment(environment, root, demoPath) {
  const port = Number(environment.DEMO_PORT || "8082");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("DEMO_PORT должен быть числом от 1 до 65535.");
  return {
    ...environment,
    BIND_ADDRESS: "127.0.0.1",
    PORT: String(port),
    LEGACY_DB_PATH: "",
    DEMO_SEED_PATH: demoPath,
    DEMO_MODE: "true",
    DB_SCHEMA: isolatedSchema(environment, "DEMO_DB_SCHEMA", "demo"),
    UPLOADS_PATH: resolve(root, ".local/demo-uploads"),
    DIST_PATH: "dist",
    DATA_PATH: "data/verified-hotels.json",
    CATALOG_IMPORT: "true",
    LAB_MODE: "false",
    ACCOUNT_MODE: "true",
    SESSION_COOKIE_SECURE: "false",
    FRONTEND_ORIGIN: "",
    SPRING_PROFILES_ACTIVE: "",
    CONTRACT_INSTANT: "",
    LLM_API_KEY: "",
    LLM_MODEL: "",
    DEEPSEEK_API_KEY: "",
    ADVISOR_LOCAL_MODEL: "",
    AI_PROVIDER: "rules",
  };
}
