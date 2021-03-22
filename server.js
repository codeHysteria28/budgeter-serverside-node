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
app.use(bodyParser.urlencoded({ extended: false }));
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
                  phone: req.body.phone,
                  address: req.body.address,
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
                  phone: doc.phone,
                  address: doc.address,
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

// backend functionality test
app.get('/ping', (req,res) => {
   return res.send('pong');
});

app.use(Sentry.Handlers.errorHandler());

app.listen(process.env.PORT || 1998, () => console.log("Running on port " + process.env.PORT || 1998));