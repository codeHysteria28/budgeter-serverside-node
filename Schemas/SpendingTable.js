const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SpendingSchema = new Schema({
    username: {type: String, required: true},
    item: {type: String, required: true},
    category: {type: String, required: true},
    price: {type: String, required: true},
    paid_at: {type: String, required: true}
},{timestamps: false, collection: 'spending_table'});

module.exports = mongoose.model('Spending',SpendingSchema);