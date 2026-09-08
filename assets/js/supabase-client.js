// =====================================================================
// Cliente único de Supabase, compartido por index.html y admin.html.
//
// La URL y la "anon key" de Supabase son seguras para vivir en el
// frontend (no son un secreto): identifican al proyecto y al rol
// "anon", y la seguridad real la dan las políticas de Row Level
// Security definidas en supabase/schema.sql (lectura pública del
// catálogo, escritura solo para usuarios autenticados).
//
// IMPORTANTE: reemplazá estos dos valores por los de tu propio
// proyecto de Supabase (Project Settings > API) antes de usar la app.
// =====================================================================

const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
const SUPABASE_ANON_KEY = "TU-ANON-KEY-AQUI";

// "supabase" es el global que expone el script UMD de @supabase/supabase-js
// cargado antes que este archivo en index.html y admin.html.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
