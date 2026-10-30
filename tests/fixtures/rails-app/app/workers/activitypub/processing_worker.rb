class ActivityPub::ProcessingWorker
  include Sidekiq::Worker

  sidekiq_options queue: 'ingress'

  def perform(account_id, body)
    ActivityPub::ProcessStatusService.new.call(JSON.parse(body))
  end
end
