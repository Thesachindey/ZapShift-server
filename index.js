const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express')
const app = express()
const cors = require('cors');
require("dotenv").config()
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000

const crypto = require("crypto");

function generateTrackingId() {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
    return `${ts}-${rand}`;
}

// console.log(generateTrackingId());
// console.log(generateTrackingId());


//middleware
app.use(express.json());
app.use(cors());
//----------------------


const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.6fqewb1.mongodb.net/?appName=Cluster0`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        //----------------start from here---------------
        //database connection
        const db = client.db('zap_shift_db');
        const parcelsCollection = db.collection('parcels');
        const paymentCollection = db.collection('payments');

        //parcels api 
        app.get('/parcels', async (req, res) => {
            const query = {}
            const { email } = req.query;
            if (email) {
                query.senderEmail = email
            }
            const result = await parcelsCollection.find(query).toArray();
            res.send(result)
        })

        //get one 
        app.get('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const result = await parcelsCollection.findOne({ _id: new ObjectId(id) });

            res.send(result)
        })

        //insert one parcel
        app.post('/parcels', async (req, res) => {
            const parcels = req.body;
            const result = await parcelsCollection.insertOne(parcels);
            res.send(result)
        })

        //parcel delete one
        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const result = await parcelsCollection.deleteOne(query);
            res.send(result);
        })

        // payment related APIs
        app.post('/payment-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: `Please pay for: ${paymentInfo.parcelName}`
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.parcelId,
                    parcelName: paymentInfo.parcelName
                },
                customer_email: paymentInfo.senderEmail,
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
            });
            res.send({ url: session.url })
        })

        //old
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.parcelName
                            }
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.senderEmail,
                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.parcelId
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
            });
            console.log(session)
            res.send({ url: session.url })
        })

        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;

            const session = await stripe.checkout.sessions.retrieve(sessionId);
            console.log('session retrieve', session)

            const trackingId = generateTrackingId();

            if (session.payment_status === 'paid') {
                const id = session.metadata.parcelId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        trackingId: trackingId,
                    }
                }
                const result = await parcelsCollection.updateOne(query, update)

                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customEmail: session.customer_email,
                    parcelId: session.metadata.parcelId,
                    parcelName: session.metadata.parcelName,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),

                }
                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(payment);

                    res.send({
                        success: true,
                        modifyParcel: result,
                        paymentInfo: resultPayment,
                        trackingId:trackingId,
                         transactionId: session.payment_intent,
                    })
                }

            }

            res.send({ success: false })
        })


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

//-----------
app.get('/', (req, res) => {
    res.send('Zap is shifting shifting!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
