import { requireClient } from "./supabase.js";

export async function signInWithPassword(email, password) {
  return requireClient().auth.signInWithPassword({
    email: String(email).trim(),
    password: String(password),
  });
}

export async function signUpPrefect({ email, password, firstName, phone, currentClass, redirectTo }) {
  return requireClient().auth.signUp({
    email: String(email).trim(),
    password: String(password),
    options: {
      emailRedirectTo: redirectTo,
      data: {
        first_name: String(firstName).trim(),
        phone: String(phone).trim(),
        current_class: String(currentClass).trim(),
      },
    },
  });
}

export async function signOut() {
  return requireClient().auth.signOut();
}
