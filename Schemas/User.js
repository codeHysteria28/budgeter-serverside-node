const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
    username: {type: String, required: true},
    password: {type: String, required: true},
    monthlyBudget: {type: Number, required: false},
    fullName: {type: String, required: true},
    email: {type: String, required: true},
    phone: {type: String, required: false},
    address: {type: String, required: false},
    conf_password: {type: String, required: true},
    created_at: {type: String, required: true}
},{ timestamps: false, collection: 'user_login' });

module.exports = mongoose.model('User', UserSchema);