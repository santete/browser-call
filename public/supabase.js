import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';


export const supabase = createClient(
"https://rgcchuswoyolsidhbpxp.supabase.co",
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnY2NodXN3b3lvbHNpZGhicHhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNzg3NjAsImV4cCI6MjA4MDY1NDc2MH0.1JpG74GJJlyv3NAfxjr2vifksUFUqzqHBlIGl9gsbqQ"
);


export async function signInWithGoogle() {
const { data, error } = await supabase.auth.signInWithOAuth({
provider: 'google'
});
if (error) console.error('Login error:', error.message);
return data;
}


export async function signOut() {
await supabase.auth.signOut();
}


export async function getCurrentUser() {
const { data } = await supabase.auth.getUser();
return data?.user || null;
}