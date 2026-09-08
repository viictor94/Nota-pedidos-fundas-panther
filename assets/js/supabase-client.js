// =====================================================================
// Cliente único de Supabase, compartido por index.html y admin.html.
//
// La URL y la "anon key" de Supabase son seguras para vivir en el
// frontend (no son un secreto): identifican al proyecto y al rol
// "anon", y la seguridad real la dan las políticas de Row Level
// Security definidas en supabase/schema.sql (lectura pública del
// catálogo, escritura solo para usuarios autenticados).
//
// Proyecto: Panther Distribuciones (ref "chgzmorbyzjzuzglwiov").
// =====================================================================

const SUPABASE_URL = "https://chgzmorbyzjzuzglwiov.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNoZ3ptb3JieXpqenV6Z2x3aW92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4OTIwMDEsImV4cCI6MjEwNDQ2ODAwMX0.Uugz_IMYYRZL8GTDfKW7zF1QDSBoNodXMhFBR3Fe9F8";

// "supabase" es el global que expone el script UMD de @supabase/supabase-js
// cargado antes que este archivo en index.html y admin.html.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
