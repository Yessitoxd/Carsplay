const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/user');

async function run(){
  const uri = process.env.MONGODB_URI;
  if(!uri){ console.error('MONGODB_URI not set'); process.exit(1); }
  await mongoose.connect(uri, { useNewUrlParser:true, useUnifiedTopology:true });
  const user = await User.findOne({ username: 'Carsplay' }).exec();
  console.log('Found user:', !!user);
  if(user){
    console.log('Stored hash:', user.password.substring(0,10),'...');
    const ok = await bcrypt.compare('Carsplay-2026', user.password);
    console.log('Password match:', ok);
  }
  await mongoose.disconnect();
}

run().catch(err=>{console.error(err);process.exit(1)});
