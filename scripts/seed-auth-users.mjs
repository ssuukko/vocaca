import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const seedUsers = [
  {
    email: 'admin@vocaca.local',
    password: 'admin',
    user_metadata: { username: 'admin', role: 'admin' },
  },
  {
    email: 'ssh@vocaca.local',
    password: 'ssh',
    user_metadata: { username: 'ssh', role: 'user' },
  },
  {
    email: 'njh@vocaca.local',
    password: 'njh',
    user_metadata: { username: 'njh', role: 'user' },
  },
];

async function seedAuthUsers() {
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    throw error;
  }

  const existingUsers = data.users;

  for (const user of seedUsers) {
    const foundUser = existingUsers.find((item) => item.email === user.email);

    if (foundUser) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(foundUser.id, {
        password: user.password,
        email_confirm: true,
        user_metadata: user.user_metadata,
      });

      if (updateError) {
        throw updateError;
      }

      console.log(`updated: ${user.email}`);
      continue;
    }

    const { error: createError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: user.user_metadata,
    });

    if (createError) {
      throw createError;
    }

    console.log(`created: ${user.email}`);
  }

  console.log('seed complete');
}

seedAuthUsers().catch((error) => {
  console.error(error);
  process.exit(1);
});
