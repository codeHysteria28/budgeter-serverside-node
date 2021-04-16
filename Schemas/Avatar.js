const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AvatarSchema = new Schema({
    avatar: {type: Buffer, required: true},
    contentType: { type: String, require: true},
    username: {type: String, require: true}
},{timestamps: true, collection: 'user_avatar'});

module.exports = mongoose.model('Avatar',AvatarSchema);