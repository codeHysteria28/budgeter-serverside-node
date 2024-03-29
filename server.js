const express = require('express');
const app = express();
const path = require('path');
const db = require('./db');
const cors = require('cors')
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const session = require("express-session");
const passport = require("passport");
const passportLocal = require("passport-local").Strategy;
const cookieParser = require("cookie-parser");
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require("express-rate-limit");
const crypto = require('crypto');
const Sentry = require('@sentry/node');
const Tracing = require('@sentry/tracing');
const multer = require('multer');
const multerAzure = require('multer-azure');
const fs = require('fs');
require('dotenv').config();

// sentry init
Sentry.init({
   dsn: "https://2d033bcf96e54300b124d8ff802b2488@o556223.ingest.sentry.io/5686799",
   integrations: [
     // enable HTTP calls tracing
     new Sentry.Integrations.Http({ tracing: true }),
     // enable Express.js middleware tracing
     new Tracing.Integrations.Express({ app }),
   ],
 
   tracesSampleRate: 1.0,
});


// RequestHandler creates a separate execution context using domains, so that every
// transaction/span/breadcrumb is attached to its own Hub instance
app.use(Sentry.Handlers.requestHandler());
// TracingHandler creates a trace for every incoming request
app.use(Sentry.Handlers.tracingHandler());

let upload = multer({
   storage: multerAzure({
      connectionString: process.env.storage_connection_string,
      account: process.env.storage_name,
      key: process.env.storage_key,
      container: process.env.storage_container,
      blobPathResolver: function(req, file, callback) {
         let blobPath = file.originalname;
         callback(null, blobPath);
      }
   }),
   fileFilter: (req, file, callback) => {
      if(file.mimetype === 'image/png' || file.mimetype === 'image/jpg' || file.mimetype === 'image/jpeg') {
         callback(null, true);
      }else {
         console.log('not support file');
         callback(null, false);
      }
   },
   limits: {
      fileSize: 1024 * 1024 * 2
   }
});

// server config

if(process.env.NODE_ENV === "production") {
   app.use(cors({
      origin: "https://budgeter.club", // <-- location of the react app were connecting to
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
      credentials: true,
   }));
}else {
   app.use(cors({
      origin: "http://localhost:3000", // <-- location of the react app were connecting to
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
      credentials: true,
   }));
}

app.enable('trust proxy');

app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
   secret: "secretcode",
   resave: false,
   saveUninitialized: false
}));


app.use(passport.initialize());
app.use(passport.session());

if (process.env.NODE_ENV === "production") {
   app.use((req, res, next) => {
      res.locals.nonce = crypto.randomBytes(16).toString("hex");
      next();
    });
   
   app.use((req,res,next) => {
      helmet.contentSecurityPolicy({
         directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", `'nonce-${res.locals.nonce}'`],
            imgSrc: ["'self'"],
            manifestSrc: ["'self'"],
            styleSrc: ["'self'",'fonts.googleapis.com'],
            fontSrc:["'self'",'fonts.gstatic.com']
         }
      })(req,res,next);
   });
   
   const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100 // limit each IP to 100 request per windowMs
   });
   
   app.use(limiter);

 }

// Schemas
const User = require('./Schemas/User');
const Spending = require('./Schemas/SpendingTable');
const Avatar = require('./Schemas/Avatar');

db.on('error', console.error.bind(console, "mongo conn err"));

db.on('connected', () => {
   console.log('connected to mongodb');
});

// adding spending entry into table spending
app.post('/add_spending', (req,res) => {
   if(req.body !== {}){
      const spending = new Spending({
         username: req.body.username,
         item: req.body.item,
         category: req.body.category,
         price: req.body.price,
         paid_at: req.body.paid_at
      });

      spending.save();
      res.send('Spending added successfully');
   }else {
      res.send('Some error happened, try again later');
   }
});

// avatar upload
app.post('/add_avatar', upload.single('avatar'), (req,res) => {
   try {
      const avatar = new Avatar({
         avatar: process.env.storage_url + req.file.originalname,
         contentType: req.file.mimetype,
         username: req.body.username
      });
   
      avatar.save();
      res.send('success');
   } catch (error) {
      console.log(error);
      res.send('error');
   }
});

app.post('/get_avatar', (req,res) => {
      if(req.body !== {}){
         const username = req.body.user;
         Avatar.findOne({username: username}, {}, {sort: {'_id': -1}}, (err, doc) => {
            if(err) throw err;
            if(doc){
               res.send(doc)
            }
         })
      }else {
         res.send('error with getting avatar');
      }
});

// login user
app.post('/login', (req,res) => {
   if(req.body !== {}){
      // get username and password from request body
      const username = req.body.username;
      const password = req.body.password;

      User.findOne({ username: username }, (err, user) => {
         if (err) throw err;
         if (!user){
            res.send("No user exists");
         }else {
            bcrypt.compare(password, user.password, (err, result) => {
               if (err) throw err;
               if (result === true) {
                  // setting JWT token for later use
                  const token = jwt.sign({_id: user._id,username: user.username}, process.env.TOKEN_SECRET);
                  res.header('auth-token',token).send(token);
               } else {
                  res.send("Wrong password");
               }
            });
         }
     });
   }
});

// getting spending data for requested username
app.post('/spending', (req,res) => {
   Spending.find({username: req.body.username}, (err,doc) => {
      if(err) throw err;
      if(doc) {
         res.send(doc);
      }
   });
});

// register user
app.post('/register', (req,res) => {
   if(req.body !== {}) {
      User.findOne({username: req.body.username}, async (err, doc) => {
            if(err) throw err;
            if (doc) res.send('User Already Exists');
            if(!doc){
               // prepare salt for hashing
               let salt = bcrypt.genSaltSync(10);
               const password = bcrypt.hashSync(req.body.password, salt);
               const conf_password = bcrypt.hashSync(req.body.conf_password, salt);

               // apply data for prepared schema
               const user = new User({
                  username: req.body.username,
                  password: password,
                  monthlyBudget: req.body.budget,
                  fullName: req.body.fullName,
                  email: req.body.email,
                  conf_password: conf_password,
                  created_at: req.body.created_at
               });

               // save user to db
               await user.save();

               // send response
               res.send('success');
            }
      });
   }else {
      res.send('error');
   }
});

// get user profile
app.post('/getProfile', (req,res) => {
   if(req.body !== {}){
      try {
         User.findOne({username: req.body.user}, (err,doc) => {
            if(err) throw err;
            if(!doc) res.send('User Profile not found');
            if(doc) {
               const new_doc = {
                  fullName: doc.fullName,
                  email: doc.email,
                  monthlyBudget: doc.monthlyBudget,
                  created_at: doc.created_at
               }
               res.send(new_doc);
            }
         });
      } catch (error) {
         console.log(error);
      }
   }
});

// logging out user
app.post('/logout', (req,res) => {
   req.session.destroy((err) => {
      if(err) throw err;
      res.clearCookie('connect.sid',{path:'/'});
      res.send('logout');
      req.logout();
   });
});

// deleting user
app.post('/deleteUser', (req, res) => {
   if(req.body !== {}){
      try {
         User.findOneAndDelete({username: req.body.username}, async (err, doc) => {
            if(err) throw err;
            if(doc) {
               // also remove all recorded data for requested user
               await Spending.deleteMany({username: req.body.username});
               res.send('Your account was successfuly deleted');
            }
         });
      } catch (error) {
         console.log(error);
         res.send(error);
      }
   }
});

app.post('/changeBudget', (req,res) => {
   if(req.body !== {}){
      try {
         User.findOneAndUpdate({username: req.body.username}, {monthlyBudget: req.body.new_budget}, {upsert: true}, (err,doc) => {
            if(err) throw err;
            if(doc) {
               res.send('success');
            }
         });
      }catch(err) {
         console.log(err);
         res.send(err);
      }
   }else {
      res.send('error');
   }
});

// backend functionality test
app.get('/ping', (req,res) => {
   return res.send('pong');
});

app.use(Sentry.Handlers.errorHandler());

app.listen(process.env.PORT || 1998, () => console.log("Running on port " + process.env.PORT || 1998));