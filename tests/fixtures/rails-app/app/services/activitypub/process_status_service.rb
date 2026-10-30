class ActivityPub::ProcessStatusService < BaseService
  def call(json)
    status = Status.create!(text: json['content'])
    DistributionWorker.perform_async(status.id)
  end
end
