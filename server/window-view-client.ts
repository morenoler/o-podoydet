/** Standalone window-view service client. No room geometry is inferred here. */
export interface WindowViewRequest {
  hotel: { id: string; lat: number; lon: number; name?: string };
  floor: number;
  ground_floor_number?: 0 | 1;
  floor_height_m?: number;
  eye_height_m?: number;
  room?: {
    id: string;
    window?: { lat?: number; lon?: number; bearing_deg?: number; horizontal_fov_deg?: number; vertical_fov_deg?: number; pitch_deg?: number };
    source?: { url: string; quote: string; retrieved_at: string };
  };
  date: string;
  utc_offset_minutes: number;
  radius_m?: number;
  data_mode?: "cached" | "live" | "fixture";
  scene_id?: string;
}

export interface WindowViewResponse {
  schema_version: "1.0";
  actual_visibility_confirmed: false;
  is_demo: boolean;
  room_resolution: {
    scope: "room_window" | "hotel_floor_scenarios";
    requested_room_id: string | null;
    floor: { floor: number; height_agl_m: number; basis: string };
    conflicts: string[];
  };
  assessments: Array<{
    observer: { id: string; bearing_deg: number; height_agl_m: number };
    categories: Record<string, { status: string; visible_in_model: boolean | null; sample_count: number }>;
    targets: Array<{ id: string; kind: string; status: "clear_in_model" | "blocked" | "outside_fov" | "unknown"; visible_in_model: boolean | null; source_ids: string[] }>;
    sun: Record<string, unknown>;
  }>;
  sources: Array<Record<string, unknown>>;
  published_claims: Array<Record<string, unknown>>;
  limitations: string[];
}

export async function fetchWindowView(request: WindowViewRequest): Promise<WindowViewResponse> {
  const base = process.env.WINDOW_VIEW_URL || "http://127.0.0.1:8011";
  const response = await fetch(new URL("/v1/views/estimate", base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(120_000),
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(`Window view service HTTP ${response.status}`);
  if (!body || typeof body !== "object" || !("schema_version" in body) || body.schema_version !== "1.0" ||
      !("actual_visibility_confirmed" in body) || body.actual_visibility_confirmed !== false ||
      !("assessments" in body) || !Array.isArray(body.assessments)) {
    throw new Error("Window view service returned an unsupported response");
  }
  return body as WindowViewResponse;
}
