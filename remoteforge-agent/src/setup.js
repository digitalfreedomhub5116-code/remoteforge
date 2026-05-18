/**
 * RemoteForge Desktop Agent - Setup & Login
 * 
 * Run this script once to sign into Supabase
 * and generate the access tokens needed for the agent.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('');
console.log('╔══════════════════════════════════════╗');
console.log('║     🔥 RemoteForge Agent Setup       ║');
console.log('╚══════════════════════════════════════╝');
console.log('');

rl.question('Enter your Supabase Email: ', (email) => {
  rl.stdoutMuted = true;
  rl.question('Enter your Supabase Password: ', async (password) => {
    rl.stdoutMuted = false;
    console.log('\n\nAuthenticating...');

    try {
      // 1. Try to sign in
      let { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      // 2. If user doesn't exist, try to sign up
      if (error && error.message.includes('Invalid login credentials')) {
        console.log('Account not found. Attempting to create one...');
        const res = await supabase.auth.signUp({
          email,
          password,
        });
        
        if (res.error) throw res.error;
        data = res.data;
        console.log('✅ Account created successfully!');
      } else if (error) {
        throw error;
      } else {
        console.log('✅ Logged in successfully!');
      }

      if (!data.session) {
        console.log('⚠️ Please check your email to verify your account, then run setup again.');
        process.exit(0);
      }

      // 3. Save tokens to .env
      const envPath = path.join(__dirname, '..', '.env');
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
      }

      // Update or append tokens
      if (envContent.includes('USER_ACCESS_TOKEN=')) {
        envContent = envContent.replace(/USER_ACCESS_TOKEN=.*/, `USER_ACCESS_TOKEN=${data.session.access_token}`);
      } else {
        envContent += `\nUSER_ACCESS_TOKEN=${data.session.access_token}`;
      }

      if (envContent.includes('USER_REFRESH_TOKEN=')) {
        envContent = envContent.replace(/USER_REFRESH_TOKEN=.*/, `USER_REFRESH_TOKEN=${data.session.refresh_token}`);
      } else {
        envContent += `\nUSER_REFRESH_TOKEN=${data.session.refresh_token}`;
      }

      fs.writeFileSync(envPath, envContent);

      console.log('✅ Tokens saved to .env file.');
      console.log('');
      console.log('🚀 You can now start the agent by running: node src/agent.js');
      console.log('');
      
    } catch (err) {
      console.error('❌ Authentication failed:', err.message);
    } finally {
      rl.close();
    }
  });

  // Mask password input
  rl._writeToOutput = function _writeToOutput(stringToWrite) {
    if (rl.stdoutMuted)
      rl.output.write("*");
    else
      rl.output.write(stringToWrite);
  };
});
