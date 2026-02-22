API Integration
Here you have all the information regarding our API Integration, if you have any questions please get in touch with your Account Manager

Token Key:

18992:6925a4ca2e0b56925a4ca2e0b86925a4ca2e0b9
Use the previous token to authenticate your requests, using the parameter mwsd.

API available methods

country
Country codes separated by comma using ISO 3166-1 Alpha-2 code (E.g. AU,PT,US)

carrier
Carrier names separated by comma (E.g. Vodafone,Orange,Claro)

verticals
Categories separated by comma (E.g. Carrier Billing,Dating,Live Cams)

status
Possible values: Active, Paused and Blocked

flows
Flows separated by comma (E.g. 1 Click,DOI,PIN Submit)

order_by
Possible values: Performance, ID and Payout

offers
Numeric values, separated by comma

payout_above
Decimal value, using dot notation (E.g. 2.5)

limit
Limit the number of offers retrieved

pages
Paginate the results retrieved

This is an example of a method that returns all available offers for your affiliate account. You can delete or add any method from the URL.

https://affiliates.mobipium.com/api/cpa/findmyoffers/?country=[country]&verticals=[vertical]&status=[status]&flows=[flows]&order_by=[order_by]&offers=[offers]&payout_above=[payout_above]&limit=100&pages=1&mwsd=18992:6925a4ca2e0b56925a4ca2e0b86925a4ca2e0b9