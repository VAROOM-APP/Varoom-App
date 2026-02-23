import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://oqpcrmdorlmskhcfkqwh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xcGNybWRvcmxtc2toY2ZrcXdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3ODQzMjEsImV4cCI6MjA4NzM2MDMyMX0.YQYmqc1MfsGIhm31A5s0h60Ku7MqW4YSyeq_e1UF5TQ'
);

export default supabase;