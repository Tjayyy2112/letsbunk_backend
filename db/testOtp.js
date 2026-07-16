async function test() {
  try {
    const res = await fetch('http://localhost:4000/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '240191601059@crescent.education' })
    });
    const data = await res.json();
    console.log('✅ Response status:', res.status);
    console.log('✅ Response body:', data);
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

test();
