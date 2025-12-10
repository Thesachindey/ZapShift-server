const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express')
const app = express()
const cors = require('cors');
require("dotenv").config()
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000

const crypto = require("crypto");

//-------
const admin = require("firebase-admin");

const serviceAccount = require("./zap-shift-ts-firebase-adminsdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
//----------

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
const verifyFBToken = async (req, res, next) => {
    // console.log('Headers in the middleware', req.headers?.authorization);
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: "Unauthorized access" })
    }

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken)
        console.log('decoded in the token', decoded);

        req.decoded_email = decoded.email;

        next();
    }
    catch (error) {
        return res.status(401).send({ message: 'unauthorized access' })
    }


}
//--------------
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
        const usersCollection = db.collection('users');
        const parcelsCollection = db.collection('parcels');
        const paymentCollection = db.collection('payments');
        const ridersCollection = db.collection('riders');

        //-----------------------------------
        //middle admin before allowing admin activity
        //must be used after verifyFBToken middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ massage: 'forbidden access' })
            }
            next()
        }

        //user related apis
        // get 
        app.get('/users', verifyFBToken, async (req, res) => {
            const searchText = req.query.searchText;
            const query = {};

            if (searchText) {
                // query.displayName = { $regex: searchText, $options: "i" }

                query.$or= [
                    { displayName: { $regex: searchText, $options: "i" } },
                    { email: { $regex: searchText, $options: "i" } }
                ]
            }


            const cursor = usersCollection.find(query).sort({ createdAt: -1 }).limit(2);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get('/users/:id', async (req, res) => {

        })

        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email
            const query = { email }
            const user = await usersCollection.findOne(query)
            res.send({ role: user?.role || 'user' })

        })


        //update
        app.patch('/users/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await usersCollection.updateOne(query, updateDoc)
            res.send(result);
        })

        // post 
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const userExist = await usersCollection.findOne({ email })

            if (userExist) {
                return res.send({ massage: 'user exist' })
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        })



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

            // console.log('session retrieve', session)
            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId }

            const paymentExist = await paymentCollection.findOne(query);
            console.log(paymentExist)

            if (paymentExist) {
                return res.send({
                    massage: 'already exists',
                    transactionId,
                    trackingId: paymentExist.trackingId,
                })
            }

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
                    trackingId: trackingId,

                }
                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(payment);

                    res.send({
                        success: true,
                        modifyParcel: result,
                        paymentInfo: resultPayment,
                        trackingId: trackingId,
                        transactionId: session.payment_intent,
                    })
                }

            }

            res.send({ success: false })
        })


        //payment related apis
        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const query = {}

            console.log('Headers--->', req.headers)
            if (email) {
                query.customEmail = email

                //check email address
                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray()
            res.send(result)
        })

        //-------------------------------------------
        //Riders related APIs
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            rider.status = 'pending';
            rider.createdAt = new Date();

            // check if rider already exists
            const exists = await ridersCollection.findOne({ riderEmail: rider.riderEmail });

            if (exists) {
                return res.send({ message: 'Already exists' });
            }

            const result = await ridersCollection.insertOne(rider);
            res.send(result);
        })

        //get
        app.get('/riders', async (req, res) => {
            const query = {}
            if (req.query.status) {
                query.status = req.query.status;
            }
            const cursor = ridersCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })
        //update
        app.patch('/riders/:id', verifyFBToken, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    status: status
                }
            }
            const result = await ridersCollection.updateOne(query, updateDoc);


            if (status === 'approved') {
                const email = req.body.email;
                const userQuery = { email }
                const updateUser = {
                    $set: {
                        role: 'rider'
                    }
                }
                const userResult = await usersCollection.updateOne(userQuery, updateUser)
            }


            res.send(result);
        })


        //riders delete one
        app.delete('/riders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const result = await ridersCollection.deleteOne(query);
            res.send(result);
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
